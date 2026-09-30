// Small display helpers shared by the progress pages.

const RESULT = {
  correct: { label: "נכון", color: "var(--good)" },
  partial: { label: "חלקי", color: "var(--warn)" },
  incorrect: { label: "לא נכון", color: "var(--bad)" },
} as const;

export const SCORE_LABELS = {
  comprehension: "הבנת השאלה",
  vocabulary: "שימוש במילים",
  grammar: "דקדוק",
  pronunciation: "הגייה",
} as const;

export type Scores = Partial<Record<keyof typeof SCORE_LABELS, number | null>>;

export function ResultBadge({ result }: { result: string }) {
  const r = RESULT[result as keyof typeof RESULT] ?? { label: result, color: "var(--muted)" };
  return <span className="whitespace-nowrap text-xs font-semibold" style={{ color: r.color }}>{r.label}</span>;
}

export function ScoreLine({ scores }: { scores: Scores }) {
  const parts = Object.entries(SCORE_LABELS).flatMap(([k, label]) => {
    const v = scores[k as keyof Scores];
    return v == null ? [] : [`${label} ${v}/5`];
  });
  return parts.length ? <span>{parts.join(" · ")}</span> : null;
}

export const correctOf = (correct: number, total: number) => `${correct}/${total} נכונות`;

export const fmtDay = (day: string) => new Date(day).toLocaleDateString("he-IL", { timeZone: "UTC" });

export const fmtTime = (ts: string | Date) =>
  new Date(ts).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" });

export const SOURCE = { assistant: "עוזר", app: "אפליקציה" } as const;
