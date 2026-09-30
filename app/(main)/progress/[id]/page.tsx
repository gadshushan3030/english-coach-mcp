import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { correctOf, fmtDay, fmtTime, ResultBadge, SCORE_LABELS, SOURCE, type Scores } from "../ui";

type Sentence = { en: string; he?: string };
type Correction = { original: string; corrected: string; note?: string };
type NewWord = { english: string; hebrew: string; example?: string };

export default async function PracticePage({ params }: PageProps<"/progress/[id]">) {
  const { id } = await params;
  const userId = await requireOwner();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [[s], exercises] = await Promise.all([
    sql<Scores & {
      id: string; day: string; level: string; source: string; mode: string; topic: string; feedback: string | null;
      completed_at: Date | null; sentences: Sentence[]; corrections: Correction[]; new_words: NewWord[];
    }>("select * from practice_sessions where id = $1 and user_id = $2", [id, userId]),
    sql<{ id: string; question: string; answer: string; expected: string | null; result: string; attempt: number; checked_by: string; english: string | null }>(
      `select e.id, e.question, e.answer, e.expected, e.result, e.attempt, e.checked_by, w.english
       from exercises e left join words w on w.id = e.word_id
       where e.session_id = $1 and e.user_id = $2 order by e.created_at`,
      [id, userId],
    ),
  ]);
  if (!s) notFound();

  const { sentences, corrections, new_words: newWords } = s;
  const correct = exercises.filter((e) => e.result === "correct").length;
  const scores = (Object.keys(SCORE_LABELS) as (keyof typeof SCORE_LABELS)[]).filter((k) => s[k] != null);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/progress" className="muted text-sm">→ כל השיחות</Link>
        <h1 className="text-2xl font-bold">{s.topic}</h1>
        <p className="muted text-sm">
          {fmtDay(s.day)} · רמה {s.level} · {SOURCE[s.source as keyof typeof SOURCE]} · {s.mode === "voice" ? "קולי" : "טקסט"}
          {s.completed_at ? ` · נשמרה ${fmtTime(s.completed_at)}` : " · פתוחה"}
        </p>
        <p dir="ltr" className="muted text-end text-xs">id: {s.id}</p>
      </div>

      {(scores.length > 0 || s.feedback) && (
        <section className="surface flex flex-col gap-3 p-4">
          {scores.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {scores.map((k) => (
                <div key={k} className="flex flex-col">
                  <span className="text-xl font-bold">{s[k]}/5</span>
                  <span className="muted text-xs">{SCORE_LABELS[k]}</span>
                </div>
              ))}
            </div>
          )}
          {s.feedback && <p dir="auto">{s.feedback}</p>}
        </section>
      )}

      <Block title="משפטים שתרגלנו" empty={!sentences.length}>
        {sentences.map((x, i) => (
          <li key={i} className="px-4 py-2.5">
            <div dir="ltr" lang="en" className="text-start">{x.en}</div>
            {x.he && <div className="muted text-sm">{x.he}</div>}
          </li>
        ))}
      </Block>

      <Block title="תיקונים" empty={!corrections.length}>
        {corrections.map((c, i) => (
          <li key={i} className="px-4 py-2.5 text-sm">
            <div dir="ltr" lang="en" className="text-start">
              <span className="text-[var(--bad)] line-through">{c.original}</span> → <span className="text-[var(--good)]">{c.corrected}</span>
            </div>
            {c.note && <div dir="auto" className="muted">{c.note}</div>}
          </li>
        ))}
      </Block>

      <Block title="מילים חדשות" empty={!newWords.length}>
        {newWords.map((w, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5">
            <span dir="ltr" lang="en" className="font-semibold">{w.english}</span>
            <span>{w.hebrew}</span>
            {w.example && <span dir="ltr" lang="en" className="muted text-sm">{w.example}</span>}
          </li>
        ))}
      </Block>

      <Block title={`תרגילים${exercises.length ? ` · ${correctOf(correct, exercises.length)}` : ""}`} empty={!exercises.length}>
        {exercises.map((e) => (
          <li key={e.id} className="flex items-start gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div dir="auto" className="font-medium">{e.question}</div>
              <div dir="auto" className="muted">תשובה: {e.answer || "—"}</div>
              {e.expected && <div dir="auto" className="muted">צפוי: {e.expected}</div>}
              <div className="muted text-xs">
                ניסיון {e.attempt} · נבדק ע״י {SOURCE[e.checked_by as keyof typeof SOURCE]}
                {e.english && ` · ${e.english}`}
              </div>
            </div>
            <ResultBadge result={e.result} />
          </li>
        ))}
      </Block>
    </>
  );
}

function Block({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ul className="surface divide-y divide-[var(--border)]">{empty ? <li className="muted p-4 text-center">אין</li> : children}</ul>
    </section>
  );
}
