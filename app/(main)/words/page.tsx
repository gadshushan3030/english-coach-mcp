import { deleteWord } from "@/app/actions";
import { createClient } from "@/lib/supabase";
import { checkedByWord } from "@/lib/stats";
import { AddWordForm } from "./AddWordForm";

const STATUS = {
  new: { label: "חדשה", color: "var(--muted)" },
  practice: { label: "לתרגול", color: "var(--warn)" },
  known: { label: "ידועה", color: "var(--good)" },
} as const;

export default async function WordsPage() {
  const supabase = await createClient();
  const [{ data: words }, { data: exercises }] = await Promise.all([
    supabase.from("words").select("id, english, hebrew, example, status").order("created_at", { ascending: false }).order("english"),
    supabase.from("exercises").select("word_id, result").not("word_id", "is", null),
  ]);
  const checked = checkedByWord(exercises ?? []);

  return (
    <>
      <h1 className="text-2xl font-bold">המילים שלי</h1>
      <AddWordForm />
      <ul className="surface divide-y divide-[var(--border)]">
        {(words ?? []).map((w) => {
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
                {checked.has(w.id) && (
                  <span className="muted" title="תשובות שנבדקו בפועל">
                    ✓ {checked.get(w.id)!.correct}/{checked.get(w.id)!.attempts}
                  </span>
                )}
              </div>
              <form action={deleteWord.bind(null, w.id)}>
                <button aria-label={`מחיקת ${w.english}`} className="muted size-11 rounded-full hover:bg-black/5 dark:hover:bg-white/10">✕</button>
              </form>
            </li>
          );
        })}
        {!words?.length && <li className="muted p-4 text-center">אין עדיין מילים</li>}
      </ul>
    </>
  );
}
