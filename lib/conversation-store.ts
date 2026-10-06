import { resolveDialogue, dialogueMetadata } from "./adaptive-content";
import { sql } from "./db";

export type ConversationResult = { picks: number[]; correct: number; total: number };
type Query = (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

// Identity comes from the authenticated server action. The expected identity is
// a stale-tab safeguard, never an alternative source of authorization.
export async function persistConversation(
  userId: string, expectedUserId: string, requestId: string, dialogueId: string,
  picks: number[], query: Query = sql,
): Promise<ConversationResult> {
  if (typeof expectedUserId !== "string" || expectedUserId !== userId) {
    throw new Error("Conversation belongs to a different signed-in user");
  }
  const dialogue = resolveDialogue(dialogueId);
  const submitted = Array.isArray(picks) ? [...picks] : [];
  if (!dialogue || typeof requestId !== "string" || !/^[\w-]{8,64}$/.test(requestId) ||
      submitted.length !== dialogue.turns.length ||
      !submitted.every((pick, index) => Number.isInteger(pick) && pick >= 0 && pick < dialogue.turns[index].options.length)) {
    throw new Error("Invalid conversation data");
  }

  const sessionRequest = `app:${requestId}`;
  const exerciseRequests = dialogue.turns.map((_, index) => `${sessionRequest}:${index}`);
  const level = dialogueMetadata(dialogue.id).level;
  const [opened] = await query("select start_practice($1, $2, $3, $4, 'text', 'app') as id", [userId, sessionRequest, dialogue.title, level]);
  const sessionId = opened?.id;
  if (typeof sessionId !== "string") throw new Error("Conversation session not found");
  const [session] = await query(
    `select id, topic, level, source, mode from practice_sessions
     where id=$1 and user_id=$2 and request_id=$3`, [sessionId, userId, sessionRequest],
  );
  if (!session || session.topic !== dialogue.title || session.level !== level || session.source !== "app" || session.mode !== "text") {
    throw new Error("Conversation request already belongs to another dialogue");
  }

  function savedPicks(rows: Record<string, unknown>[], complete: boolean) {
    const canonical: (number | undefined)[] = Array(dialogue!.turns.length).fill(undefined);
    for (const row of rows) {
      const index = exerciseRequests.indexOf(String(row.request_id));
      const turn = dialogue!.turns[index];
      const selected = turn?.options.findIndex((option) => option === row.answer) ?? -1;
      if (!turn || selected < 0 || canonical[index] !== undefined || row.session_id !== sessionId ||
          row.question !== turn.they || row.expected !== turn.options[turn.answer] ||
          row.result !== (selected === turn.answer ? "correct" : "incorrect") ||
          row.checked_by !== "app" || row.response_format !== "multiple_choice" ||
          row.question_id !== null || row.selected_index !== null || row.word_id !== null) {
        throw new Error("Stored conversation answer does not match this dialogue");
      }
      canonical[index] = selected;
    }
    if (complete && canonical.some((pick) => pick === undefined)) throw new Error("Conversation answers are incomplete");
    return canonical;
  }
  const readColumns = "request_id, session_id, question, answer, expected, result, checked_by, response_format, question_id, selected_index, word_id";
  // Reject reserved-ID collisions before finish_practice can rewrite session
  // metadata or adopt a checked exercise from an unrelated conversation.
  const prior = await query(`select ${readColumns} from exercises where user_id=$1 and request_id=any($2::text[])`, [userId, exerciseRequests]);
  savedPicks(prior, false);

  await query("select finish_practice(p_user_id => $1, p_session_id => $2, p_sentences => $3, p_exercises => $4, p_checked_by => 'app')", [
    userId, sessionId,
    JSON.stringify(dialogue.turns.map((turn) => ({ en: turn.options[turn.answer], he: turn.answerHe }))),
    JSON.stringify(dialogue.turns.map((turn, index) => ({
      request_id: exerciseRequests[index], response_format: "multiple_choice", question: turn.they,
      answer: turn.options[submitted[index]], expected: turn.options[turn.answer],
      result: submitted[index] === turn.answer ? "correct" : "incorrect",
    }))),
  ]);
  // A conflicting retry can have different local picks. Only the persisted first
  // checked answers determine the UI result, including an uncertain response.
  const stored = await query(`select ${readColumns} from exercises
    where user_id=$1 and session_id=$2 and request_id=any($3::text[])`, [userId, sessionId, exerciseRequests]);
  const canonical = savedPicks(stored, true) as number[];
  return { picks: canonical, correct: canonical.filter((pick, index) => pick === dialogue.turns[index].answer).length, total: dialogue.turns.length };
}
