import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { correctOf, fmtDay, fmtTime, ResultBadge, SCORE_LABELS, SOURCE } from "../ui";

type Sentence = { en: string; he?: string };
type Correction = { original: string; corrected: string; note?: string };
type NewWord = { english: string; hebrew: string; example?: string };

export default async function PracticePage({ params }: PageProps<"/progress/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: s } = await supabase
    .from("practice_sessions")
    .select("*, exercises(id, question, answer, expected, result, attempt, checked_by, created_at, words(english))")
    .eq("id", id)
    .maybeSingle();
  if (!s) notFound();

  const sentences = s.sentences as Sentence[];
  const corrections = s.corrections as Correction[];
  const newWords = s.new_words as NewWord[];
  const exercises = [...s.exercises].sort((a, b) => a.created_at.localeCompare(b.created_at));
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

      <Block title={`תרגילים${exercises.length ? ` · ${correctOf(exercises)}` : ""}`} empty={!exercises.length}>
        {exercises.map((e) => (
          <li key={e.id} className="flex items-start gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div dir="auto" className="font-medium">{e.question}</div>
              <div dir="auto" className="muted">תשובה: {e.answer || "—"}</div>
              {e.expected && <div dir="auto" className="muted">צפוי: {e.expected}</div>}
              <div className="muted text-xs">
                ניסיון {e.attempt} · נבדק ע״י {SOURCE[e.checked_by as keyof typeof SOURCE]}
                {e.words && ` · ${e.words.english}`}
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
