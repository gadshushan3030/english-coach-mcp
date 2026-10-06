// Small display helpers shared by the home and progress pages.
import { Icon } from "@/components/Icon";

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

export const SHORT_LABELS = { comprehension: "הבנה", vocabulary: "מילים", grammar: "דקדוק", pronunciation: "הגייה" } as const;

export type Scores = Partial<Record<keyof typeof SCORE_LABELS, number | null>>;

export function ResultBadge({ result }: { result: string }) {
  const r = RESULT[result as keyof typeof RESULT] ?? { label: result, color: "var(--muted)" };
  return <span className="whitespace-nowrap text-xs font-semibold" style={{ color: r.color }}>{r.label}</span>;
}

export function ResponseFormatChip({ format }: { format: string }) {
  const label = format === "multiple_choice"
    ? "זיהוי בבחירה"
    : format === "gap_completion"
      ? "השלמת משפט"
    : format === "free_response"
      ? "ניסוח עצמאי"
      : "סוג מענה לא תועד";
  return <span className="chip">{label}</span>;
}

export function ScoreLine({ scores }: { scores: Scores }) {
  const parts = Object.entries(SHORT_LABELS).flatMap(([k, label]) => {
    const v = scores[k as keyof Scores];
    return v == null ? [] : [`${label} ${v}`];
  });
  return parts.length ? <span>{parts.join(" · ")}</span> : null;
}

// A 1–5 score as five segments; a fractional average fills part of the last one.
export function Meter({ value, thin = false }: { value: number; thin?: boolean }) {
  return (
    <div className="grid grid-cols-5 gap-[3px]" role="img" aria-label={`${value} מתוך 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={`flex overflow-hidden rounded-[3px] bg-track ${thin ? "h-1.5" : "h-2.5"}`}>
          <div className="bg-accent" style={{ width: `${Math.max(0, Math.min(1, value - i)) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

// Where a session came from: the assistant (dark chip) or the app itself (outlined).
export function SourceChip({ source }: { source: string }) {
  return source === "assistant" ? (
    <span className="chip bg-ink text-surface">
      <Icon name="spark" size={11} strokeWidth={2} />
      מאמן
    </span>
  ) : (
    <span className="chip border border-line bg-transparent">אפליקציה</span>
  );
}

export const correctOf = (correct: number, total: number) => `${correct}/${total} נכונות`;

export const fmtDay = (day: string) => new Date(day).toLocaleDateString("he-IL", { timeZone: "UTC" });

export const fmtTime = (ts: string | Date) =>
  new Date(ts).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" });

// "היום" / "אתמול" / a short date, by Israel time.
export function fmtRelDay(ts: string | Date) {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const target = day(new Date(ts));
  if (target === day(new Date())) return "היום";
  if (target === day(new Date(Date.now() - 864e5))) return "אתמול";
  return new Date(ts).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" });
}

export const SOURCE = { assistant: "עוזר", app: "אפליקציה" } as const;
