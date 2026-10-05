import { deleteWord } from "@/app/actions";
import { Icon } from "@/components/Icon";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AddWordForm } from "./AddWordForm";

const STATUS = {
  new: { label: "חדשה", color: "var(--muted)" },
  practice: { label: "לתרגול", color: "var(--warn)" },
  known: { label: "ידועה", color: "var(--good)" },
} as const;

export default async function WordsPage() {
  const userId = await requireUser();
  const words = await sql<{ id: string; english: string; hebrew: string; example: string | null; status: string; correct: number; attempts: number }>(
    `select w.id, w.english, w.hebrew, w.example, w.status,
            count(e.id) filter (where e.result = 'correct')::int as correct, count(e.id)::int as attempts
     from words w left join exercises e on e.word_id = w.id
     where w.user_id = $1
     group by w.id order by w.created_at desc, w.english`,
    [userId],
  );

  return (
    <>
      <h1 className="text-[26px] font-bold">המילים שלי</h1>
      <AddWordForm />
      <ul className="surface divide-y divide-line overflow-hidden">
        {words.map((w) => {
          const s = STATUS[w.status as keyof typeof STATUS];
          return (
            <li key={w.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span dir="ltr" lang="en" className="font-semibold">{w.english}</span>
                  <span>{w.hebrew}</span>
                </div>
                {w.example && <div dir="ltr" lang="en" className="muted truncate text-start text-sm">{w.example}</div>}
              </div>
              <div className="flex flex-col items-end text-xs">
                <span className="font-medium" style={{ color: s.color }} title="סימון עצמי">{s.label}</span>
                {w.attempts > 0 && (
                  <span className="muted" title="תשובות שנבדקו בפועל">
                    ✓ {w.correct}/{w.attempts}
                  </span>
                )}
              </div>
              <form action={deleteWord.bind(null, w.id)}>
                <button aria-label={`מחיקת ${w.english}`} className="muted flex size-11 items-center justify-center rounded-full hover:bg-ground">
                  <Icon name="x" size={18} />
                </button>
              </form>
            </li>
          );
        })}
        {!words.length && <li className="muted p-4 text-center">אין עדיין מילים</li>}
      </ul>
    </>
  );
}
