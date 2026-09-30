export type Checked = { correct: number; attempts: number };

// Checked answers per word: how many of the attempts were correct.
export function checkedByWord(rows: { word_id: string | null; result: string }[]) {
  const byWord = new Map<string, Checked>();
  for (const r of rows) {
    if (!r.word_id) continue;
    const s = byWord.get(r.word_id) ?? { correct: 0, attempts: 0 };
    s.attempts++;
    if (r.result === "correct") s.correct++;
    byWord.set(r.word_id, s);
  }
  return byWord;
}
