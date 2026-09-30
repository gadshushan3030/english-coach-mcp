import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { checkedByWord } from "@/lib/stats";
import { createTokenClient, today } from "@/lib/supabase";

const INSTRUCTIONS = `Practice data for one Hebrew-speaking learner of English (very basic level).

Workflow for a conversation:
1. get_progress – due words and recent practice.
2. start_practice – before talking (topic, CEFR level, mode "voice" only when speaking aloud).
3. Talk with the learner.
4. save_practice_results – once at the end: sentences practiced, corrections, new words, rubric scores, short feedback, and every exercise you checked.
5. get_practice – read the record back to confirm it was stored.

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

// Throws on a DB error so the SDK returns it to the assistant as a tool error.
async function run<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as NonNullable<T>;
}

// One server per request, bound to the caller's OAuth token: every query runs under RLS as that user.
export function buildServer(token: string) {
  const db = createTokenClient(token);
  const server = new McpServer({ name: "gad-english", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "get_progress",
    {
      title: "Read progress and words to review",
      description: "Word counts, self-marks vs. checked answers, words due for review now, and the latest practice sessions.",
      inputSchema: z.object({ due_limit: z.number().int().min(1).max(100).default(20) }),
      annotations: READ,
    },
    async ({ due_limit }) => {
      const now = new Date().toISOString();
      const count = () => db.from("words").select("*", { count: "exact", head: true });
      const [total, known, practice, due, dueWords, exercises, sessions] = await Promise.all([
        count(),
        count().eq("status", "known"),
        count().eq("status", "practice"),
        count().lte("due_at", now),
        run(db.from("words").select("id, english, hebrew, example, box, due_at").lte("due_at", now).order("due_at").limit(due_limit)),
        run(db.from("exercises").select("word_id, result")),
        run(
          db
            .from("practice_sessions")
            .select("id, day, source, topic, level, mode, completed_at, comprehension, vocabulary, grammar, pronunciation, exercises(result)")
            .order("started_at", { ascending: false })
            .limit(5),
        ),
      ]);
      const byWord = checkedByWord(exercises);
      const tally = (r: string) => exercises.filter((e) => e.result === r).length;

      return json({
        today: today(),
        words: { total: total.count, self_marked_known: known.count, self_marked_practice: practice.count, due_now: due.count },
        checked_answers: { correct: tally("correct"), partial: tally("partial"), incorrect: tally("incorrect"), attempts: exercises.length },
        due_words: dueWords.map((w) => ({
          english: w.english,
          hebrew: w.hebrew,
          example: w.example,
          familiarity: w.box,
          checked: byWord.get(w.id) ?? { correct: 0, attempts: 0 },
        })),
        recent_practice: sessions.map(({ exercises: ex, ...s }) => ({
          ...s,
          exercises: { correct: ex.filter((e) => e.result === "correct").length, total: ex.length },
        })),
      });
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
      const id = await run(db.rpc("start_practice", { p_request_id: request_id, p_topic: topic, p_level: level, p_mode: mode }));
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
        const s = await run(db.from("practice_sessions").select("mode").eq("id", a.practice_id).single());
        if (s.mode !== "voice") throw new Error("pronunciation can only be scored in a voice session (start_practice mode: voice)");
      }
      await run(
        db.rpc("finish_practice", {
          p_session_id: a.practice_id,
          p_sentences: a.sentences,
          p_corrections: a.corrections,
          p_new_words: a.new_words,
          p_comprehension: a.scores.comprehension,
          p_vocabulary: a.scores.vocabulary,
          p_grammar: a.scores.grammar,
          p_pronunciation: a.scores.pronunciation,
          p_feedback: a.feedback,
          p_exercises: a.exercises,
        }),
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
        ids.push(
          await run(
            db.rpc("record_exercise", {
              p_request_id: e.request_id,
              p_question: e.question,
              p_answer: e.answer,
              p_result: e.result,
              p_expected: e.expected,
              p_attempt: e.attempt,
              p_session_id: practice_id,
              p_word: e.word,
            }),
          ),
        );
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
      const english = words.map((w) => w.english);
      const existing = new Set((await run(db.from("words").select("english").in("english", english))).map((w) => w.english));
      await run(db.from("words").upsert(words, { onConflict: "user_id,english", ignoreDuplicates: true }));
      const rows = await run(db.from("words").select("id, english, hebrew, box").in("english", english));
      return json({ words: rows.map((w) => ({ ...w, familiarity: w.box, box: undefined, already_existed: existing.has(w.english) })) });
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
      const id = await run(db.rpc("set_word_familiarity", { p_word: word, p_level: familiarity }));
      const w = await run(db.from("words").select("id, english, box, due_at").eq("id", id).single());
      return json({ word_id: w.id, english: w.english, familiarity: w.box, next_review: w.due_at });
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
      const s = await run(db.from("practice_sessions").select("*, exercises(*)").eq("id", practice_id).single());
      return json(s);
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
    async ({ exercise_ids }) => json(await run(db.from("exercises").select("*").in("id", exercise_ids))),
  );

  return server;
}
