import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { sql, today } from "@/lib/db";
import { practiceQuestionInput, responseFormat } from "@/lib/practice-questions";
import { listPendingQuestions, queuePracticeQuestion } from "@/lib/question-store";

const INSTRUCTIONS = `Practice data for one Hebrew-speaking learner of English (very basic level).

Workflow for a conversation:
1. get_progress – due words and recent practice.
2. start_practice – before talking (topic, CEFR level, mode "voice" only when speaking aloud).
3. Talk with the learner.
4. save_practice_results – once at the end: sentences practiced, corrections, new words, rubric scores, short feedback, and every exercise you checked.
5. get_practice – read the record back to confirm it was stored.
6. queue_practice_question – optionally turn actual errors into short questions for later practice in /talk. Supply exactly three distinct English choices, one correct_index (0–2), the actual original sentence, and a short Hebrew explanation. Link source_session_id when available. Never invent mistakes or record unanswered questions as checked exercises.
7. get_pending_questions – confirm queued questions. Queuing does not count as learning evidence.

Mark each checked exercise response_format as multiple_choice (recognition) or free_response (learner produced the answer). If unknown, omit it; historical/unspecified records are not evidence of free recall.

Rubric, 1-5 each: comprehension = understood the question; vocabulary = used fitting words; grammar = correct sentences; pronunciation = only in voice mode, otherwise omit it.

Exercises are answers YOU checked (result correct / partial / incorrect). Never record the learner's own "I know it" as an exercise.
Every write takes request_id: generate a new UUID for each logical save and reuse it when retrying – replays never create duplicates.
Words are identified by their English text. Write feedback short and in Hebrew.`;

const requestId = z
  .string()
  .min(8)
  .max(100)
  .describe("A UUID you generate for this save. Reuse the same value on retry so nothing is stored twice.");
const level = z.enum(["A0", "A1", "A2", "B1", "B2", "C1", "C2"]);
const score = z.number().int().min(1).max(5);
const newWord = z.object({
  english: z.string().trim().min(1).max(100),
  hebrew: z.string().trim().min(1).max(100),
  example: z.string().max(300).optional().describe("Short English example sentence"),
});
const exercise = z.object({
  request_id: requestId,
  response_format: responseFormat.default("unspecified").describe("multiple_choice is recognition, free_response is independently produced; unspecified if unknown"),
  question: z.string().min(1).max(500),
  answer: z.string().max(1000).describe("What the learner actually answered"),
  expected: z.string().max(500).optional().describe("The correct / model answer"),
  result: z.enum(["correct", "partial", "incorrect"]).describe("Your check of the answer"),
  attempt: z.number().int().min(1).max(50).optional().describe("Attempt number for this question; omit to count automatically"),
  word: z.string().max(100).optional().describe("English word from the deck this exercise tests; its review schedule is updated"),
});

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

// One server per request, bound to the user behind the verified OAuth token.
// Every query is scoped to that user id; DB errors surface to the assistant as tool errors.
export function buildServer(userId: string) {
  const server = new McpServer({ name: "english-coach", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "get_progress",
    {
      title: "Read progress and words to review",
      description: "Word counts, self-marks vs. checked answers, words due for review now, and the latest practice sessions.",
      inputSchema: z.object({ due_limit: z.number().int().min(1).max(100).default(20) }),
      annotations: READ,
    },
    async ({ due_limit }) => {
      const [[words], [checked], dueWords, recent] = await Promise.all([
        sql(
          `select count(*)::int as total,
                  count(*) filter (where status = 'known')::int as self_marked_known,
                  count(*) filter (where status = 'practice')::int as self_marked_practice,
                  count(*) filter (where due_at <= now())::int as due_now
           from words where user_id = $1`,
          [userId],
        ),
        sql(
          `select count(*) filter (where result = 'correct')::int as correct,
                  count(*) filter (where result = 'partial')::int as partial,
                  count(*) filter (where result = 'incorrect')::int as incorrect,
                  count(*)::int as attempts,
                  count(*) filter (where response_format = 'multiple_choice')::int as multiple_choice_attempts,
                  count(*) filter (where response_format = 'free_response')::int as free_response_attempts,
                  count(*) filter (where response_format = 'unspecified')::int as unspecified_attempts
           from exercises where user_id = $1`,
          [userId],
        ),
        sql(
          `select w.english, w.hebrew, w.example, w.box as familiarity,
                  json_build_object('correct', count(e.id) filter (where e.result = 'correct'), 'attempts', count(e.id)) as checked
           from words w left join exercises e on e.word_id = w.id
           where w.user_id = $1 and w.due_at <= now()
           group by w.id order by w.due_at limit $2`,
          [userId, due_limit],
        ),
        sql(
          `select s.id, s.day, s.source, s.topic, s.level, s.mode, s.completed_at,
                  s.comprehension, s.vocabulary, s.grammar, s.pronunciation,
                  json_build_object('correct', count(e.id) filter (where e.result = 'correct'), 'total', count(e.id)) as exercises
           from practice_sessions s left join exercises e on e.session_id = s.id
           where s.user_id = $1 group by s.id order by s.started_at desc limit 5`,
          [userId],
        ),
      ]);
      return json({ today: today(), words, checked_answers: checked, due_words: dueWords, recent_practice: recent });
    },
  );

  server.registerTool(
    "start_practice",
    {
      title: "Open a practice conversation",
      description: "Opens a practice session and returns practice_id. Call before the conversation starts.",
      inputSchema: z.object({
        request_id: requestId,
        topic: z.string().min(1).max(200),
        level,
        mode: z.enum(["text", "voice"]).default("text").describe("voice only when the learner speaks aloud"),
      }),
      annotations: WRITE,
    },
    async ({ request_id, topic, level, mode }) => {
      const [{ id }] = await sql<{ id: string }>("select start_practice($1, $2, $3, $4, $5) as id", [userId, request_id, topic, level, mode]);
      return json({ practice_id: id });
    },
  );

  server.registerTool(
    "save_practice_results",
    {
      title: "Save a practice conversation",
      description:
        "Stores the results of a session opened with start_practice: sentences, corrections, new words (also added to the deck), rubric scores, feedback and checked exercises. Safe to call again with the same data.",
      inputSchema: z.object({
        practice_id: z.uuid(),
        sentences: z.array(z.object({ en: z.string().min(1).max(500), he: z.string().max(500).optional() })).max(100).default([]),
        corrections: z
          .array(z.object({ original: z.string().min(1).max(500), corrected: z.string().min(1).max(500), note: z.string().max(300).optional() }))
          .max(100)
          .default([]),
        new_words: z.array(newWord).max(50).default([]),
        scores: z.object({
          comprehension: score,
          vocabulary: score,
          grammar: score,
          pronunciation: score.optional().describe("Only for voice sessions"),
        }),
        feedback: z.string().min(1).max(1000).describe("Short feedback, in Hebrew"),
        exercises: z.array(exercise).max(100).default([]),
      }),
      annotations: WRITE,
    },
    async (a) => {
      if (a.scores.pronunciation != null) {
        const [s] = await sql<{ mode: string }>("select mode from practice_sessions where id = $1 and user_id = $2", [a.practice_id, userId]);
        if (s?.mode !== "voice") throw new Error("pronunciation can only be scored in a voice session (start_practice mode: voice)");
      }
      await sql(
        `select finish_practice(p_user_id => $1, p_session_id => $2, p_sentences => $3, p_corrections => $4, p_new_words => $5,
           p_comprehension => $6, p_vocabulary => $7, p_grammar => $8, p_pronunciation => $9, p_feedback => $10, p_exercises => $11)`,
        [
          userId,
          a.practice_id,
          JSON.stringify(a.sentences),
          JSON.stringify(a.corrections),
          JSON.stringify(a.new_words),
          a.scores.comprehension,
          a.scores.vocabulary,
          a.scores.grammar,
          a.scores.pronunciation ?? null,
          a.feedback,
          JSON.stringify(a.exercises),
        ],
      );
      return json({
        practice_id: a.practice_id,
        saved: { sentences: a.sentences.length, corrections: a.corrections.length, new_words: a.new_words.length, exercises: a.exercises.length },
        verify_with: "get_practice",
      });
    },
  );

  server.registerTool(
    "record_exercises",
    {
      title: "Save checked exercises",
      description: "Stores answers you checked outside save_practice_results (e.g. a quick word quiz). Returns one exercise id per item.",
      inputSchema: z.object({ practice_id: z.uuid().optional(), exercises: z.array(exercise).min(1).max(50) }),
      annotations: WRITE,
    },
    async ({ practice_id, exercises }) => {
      const ids: string[] = [];
      for (const e of exercises) {
        const [{ id }] = await sql<{ id: string }>("select record_exercise($1, $2, $3, $4, $5, $6, $7, $8, $9, p_response_format => $10) as id", [
          userId,
          e.request_id,
          e.question,
          e.answer,
          e.result,
          e.expected ?? null,
          e.attempt ?? null,
          practice_id ?? null,
          e.word ?? null,
          e.response_format,
        ]);
        ids.push(id);
      }
      return json({ exercise_ids: ids, verify_with: "get_exercises" });
    },
  );

  server.registerTool(
    "add_words",
    {
      title: "Add words to the deck",
      description: "Adds new words. Words that already exist are left unchanged.",
      inputSchema: z.object({ words: z.array(newWord).min(1).max(50) }),
      annotations: WRITE,
    },
    async ({ words }) => {
      const added = await sql<{ english: string }>(
        `insert into words (user_id, english, hebrew, example)
         select $1, w.english, w.hebrew, w.example from jsonb_to_recordset($2) as w(english text, hebrew text, example text)
         on conflict (user_id, english) do nothing returning english`,
        [userId, JSON.stringify(words)],
      );
      const isNew = new Set(added.map((w) => w.english));
      const rows = await sql<{ id: string; english: string; hebrew: string; familiarity: number }>(
        "select id, english, hebrew, box as familiarity from words where user_id = $1 and english = any($2)",
        [userId, words.map((w) => w.english)],
      );
      return json({ words: rows.map((w) => ({ ...w, already_existed: !isNew.has(w.english) })) });
    },
  );

  server.registerTool(
    "set_word_familiarity",
    {
      title: "Update how well a word is known",
      description: "Sets familiarity 0-6 (0 = new, 6 = mastered) and reschedules the next review (0 = now, then 1/3/7/14/30/60 days).",
      inputSchema: z.object({ word: z.string().min(1).max(100), familiarity: z.number().int().min(0).max(6) }),
      annotations: WRITE,
    },
    async ({ word, familiarity }) => {
      // Separate statement: a query can't see its own function's UPDATE in the same snapshot.
      const [{ id }] = await sql<{ id: string }>("select set_word_familiarity($1, $2, $3) as id", [userId, word, familiarity]);
      const [w] = await sql("select id as word_id, english, box as familiarity, due_at as next_review from words where id = $1", [id]);
      return json(w);
    },
  );

  server.registerTool(
    "get_practice",
    {
      title: "Read a practice session",
      description: "Returns a stored practice session with all its exercises, to confirm what was saved.",
      inputSchema: z.object({ practice_id: z.uuid() }),
      annotations: READ,
    },
    async ({ practice_id }) => {
      const [session] = await sql("select * from practice_sessions where id = $1 and user_id = $2", [practice_id, userId]);
      if (!session) throw new Error("practice session not found");
      const exercises = await sql("select * from exercises where session_id = $1 and user_id = $2 order by created_at", [practice_id, userId]);
      return json({ ...session, exercises });
    },
  );

  server.registerTool(
    "get_exercises",
    {
      title: "Read exercises",
      description: "Returns stored exercises by id, to confirm what was saved.",
      inputSchema: z.object({ exercise_ids: z.array(z.uuid()).min(1).max(100) }),
      annotations: READ,
    },
    async ({ exercise_ids }) =>
      json(await sql("select * from exercises where user_id = $1 and id = any($2::uuid[]) order by created_at", [userId, exercise_ids])),
  );

  server.registerTool(
    "queue_practice_question",
    {
      title: "Queue a question from a conversation error",
      description: "Save an unanswered personalized three-choice question for later practice in /talk. Use only actual conversation errors. This does not record an exercise or move a word schedule. Reuse request_id on retry; the first saved question is preserved.",
      inputSchema: practiceQuestionInput,
      annotations: WRITE,
    },
    async (input) => json({ question_id: await queuePracticeQuestion(userId, input), verify_with: "get_pending_questions" }),
  );

  server.registerTool(
    "get_pending_questions",
    {
      title: "Read pending personalized questions",
      description: "Unanswered questions for this learner, without answer keys. Completed questions leave the queue; answers appear in get_exercises and progress.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20) }),
      annotations: READ,
    },
    async ({ limit }) => json({ questions: await listPendingQuestions(userId, limit) }),
  );

  return server;
}
