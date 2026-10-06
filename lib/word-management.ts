import { sql } from "@/lib/db";

export type WordInput = { english: string; hebrew: string; example: string | null };
export type WordMutationResult = { ok: true; id: string } | { ok: false; error: string };
export type ReviewMark = { id: string; wordId: string; knew: boolean };
type Query = (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

export class WordInputError extends Error {}

export function parseWordInput(input: unknown): WordInput {
  if (!input || typeof input !== "object") throw new WordInputError("צריך למלא מילה ותרגום");
  const value = input as Record<string, unknown>;
  if (typeof value.english !== "string" || typeof value.hebrew !== "string" ||
      (value.example != null && typeof value.example !== "string")) {
    throw new WordInputError("צריך למלא מילה ותרגום");
  }
  const english = value.english.trim();
  const hebrew = value.hebrew.trim();
  const example = typeof value.example === "string" ? value.example.trim() || null : null;
  if (!english || !hebrew) throw new WordInputError("צריך למלא מילה ותרגום");
  if (Array.from(english).length > 100 || Array.from(hebrew).length > 100) {
    throw new WordInputError("המילה והתרגום יכולים להכיל עד 100 תווים כל אחד");
  }
  if (example && Array.from(example).length > 300) throw new WordInputError("הדוגמה יכולה להכיל עד 300 תווים");
  return { english, hebrew, example };
}

function validWordId(wordId: string) {
  if (typeof wordId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wordId)) {
    throw new WordInputError("המילה לא נמצאה");
  }
}

export async function createWord(userId: string, input: unknown, query: Query = sql) {
  const word = parseWordInput(input);
  const rows = await query(
    `insert into words (user_id, english, hebrew, example) values ($1, $2, $3, $4)
     on conflict (user_id, english) do update
       set archived_at = null, hebrew = excluded.hebrew, example = excluded.example
       where words.archived_at is not null
          or (words.hebrew = excluded.hebrew and words.example is not distinct from excluded.example)
     returning id`,
    [userId, word.english, word.hebrew, word.example],
  );
  if (!rows[0]) throw new WordInputError("המילה כבר קיימת ברשימה");
  return String(rows[0].id);
}

export async function updateWord(userId: string, wordId: string, input: unknown, query: Query = sql) {
  validWordId(wordId);
  const word = parseWordInput(input);
  const rows = await query(
    `update words set english = $3, hebrew = $4, example = $5
     where id = $1 and user_id = $2 and archived_at is null returning id`,
    [wordId, userId, word.english, word.hebrew, word.example],
  );
  if (!rows[0]) throw new WordInputError("המילה לא נמצאה. אפשר לרענן את הרשימה ולנסות שוב");
  return String(rows[0].id);
}

export async function archiveWordForUser(userId: string, wordId: string, query: Query = sql) {
  validWordId(wordId);
  await query("select archive_word($1, $2)", [userId, wordId]);
  return wordId;
}

export async function restoreWordForUser(userId: string, wordId: string, query: Query = sql) {
  validWordId(wordId);
  await query("select restore_word($1, $2)", [userId, wordId]);
  return wordId;
}

export async function recordWordReview(userId: string, wordId: string, knew: boolean, requestId: string, query: Query = sql): Promise<ReviewMark> {
  validWordId(wordId);
  if (typeof knew !== "boolean" || typeof requestId !== "string" || !/^[A-Za-z0-9:_-]{8,100}$/.test(requestId)) {
    throw new WordInputError("הסימון לא תקין");
  }
  const [saved] = await query("select review_word_once($1, $2, $3, $4)::text as id", [userId, wordId, knew, requestId]);
  const [result] = await query("select id::text, word_id, knew from reviews where id = $1 and user_id = $2", [saved.id, userId]);
  return { id: String(result.id), wordId: String(result.word_id), knew: result.knew === true };
}
