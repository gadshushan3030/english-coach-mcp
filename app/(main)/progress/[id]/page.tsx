import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { TopBar } from "@/components/TopBar";
import { sql } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { correctOf, fmtDay, fmtTime, Meter, ResponseFormatChip, ResultBadge, SCORE_LABELS, SOURCE, type Scores } from "../ui";

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
    sql<{ id: string; question: string; answer: string; expected: string | null; result: string; attempt: number; checked_by: string; english: string | null; response_format: string }>(
      `select e.id, e.question, e.answer, e.expected, e.result, e.attempt, e.checked_by, e.response_format, w.english
       from exercises e left join words w on w.id = e.word_id
       where e.session_id = $1 and e.user_id = $2 order by e.created_at`,
      [id, userId],
    ),
  ]);
  if (!s) notFound();

  const { sentences, corrections, new_words: newWords } = s;
  const correct = exercises.filter((e) => e.result === "correct").length;
  const scores = (Object.keys(SCORE_LABELS) as (keyof typeof SCORE_LABELS)[]).filter((k) => s[k] != null);

  const fromCoach = s.source === "assistant";

  return (
    <>
      <TopBar title="פרטי שיחה" back="/progress" backLabel="חזרה להתקדמות" />

      <header className="flex flex-col gap-2">
        <span className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          {fromCoach ? (
            <span className="chip bg-ink text-[12.5px] text-surface">
              <Icon name="spark" size={13} strokeWidth={2} />
              המאמן ב־ChatGPT
            </span>
          ) : (
            <span className="chip border border-line bg-surface text-[12.5px]">אפליקציה</span>
          )}
          <span className="chip border border-line bg-surface text-[12.5px]">{s.mode === "voice" ? "קולי" : "טקסט"}</span>
          <span className="chip border border-line bg-surface font-mono text-[12.5px]">{s.level}</span>
          {!s.completed_at && <span className="chip bg-warn-soft text-[12.5px] text-warn">פתוחה</span>}
        </span>
        <h1 className="text-[28px] font-bold">{s.topic}</h1>
        <p className="muted text-[13px]">{s.completed_at ? fmtTime(s.completed_at) : fmtDay(s.day)}</p>
      </header>

      {scores.length > 0 && (
        <section aria-label="ניקוד" className="grid grid-cols-2 gap-2.5">
          {scores.map((k) => (
            <div key={k} className="surface flex flex-col gap-2 rounded-2xl px-3.5 py-3">
              <span className="muted text-[13px]">{SCORE_LABELS[k]}</span>
              <span dir="ltr" className="flex items-baseline gap-0.5 self-start">
                <span className="text-[28px] font-semibold tabular-nums">{s[k]}</span>
                <span className="muted text-[13px]">/5</span>
              </span>
              <Meter value={s[k]!} thin />
            </div>
          ))}
        </section>
      )}

      {s.feedback && (
        <section className="flex flex-col gap-1.5 rounded-2xl bg-accent-soft px-4 py-3.5">
          <span className="text-[12.5px] font-semibold text-accent">{fromCoach ? "משוב מהמאמן" : "משוב"}</span>
          <p dir="auto" className="text-[15px] leading-relaxed">{s.feedback}</p>
        </section>
      )}

      {corrections.length > 0 && (
        <Block title="תיקונים">
          {corrections.map((c, i) => (
            <div key={i} className="surface flex flex-col gap-1.5 rounded-2xl px-3.5 py-3">
              <span className="text-xs font-semibold text-warn">אמרת</span>
              <span dir="ltr" lang="en" className="muted text-start text-base line-through decoration-warn">{c.original}</span>
              <span className="text-xs font-semibold text-accent">נכון יותר</span>
              <span dir="ltr" lang="en" className="text-start text-base font-medium">{c.corrected}</span>
              {c.note && <span dir="auto" className="muted text-[13px]">{c.note}</span>}
            </div>
          ))}
        </Block>
      )}

      {newWords.length > 0 && (
        <Block title="מילים חדשות" note={fromCoach ? "נוספו לכרטיסיות" : undefined}>
          <div className="flex flex-wrap gap-2">
            {newWords.map((w, i) => (
              <span key={i} title={w.example} className="surface inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm">
                <span dir="ltr" lang="en" className="font-semibold">{w.english}</span>
                <span className="muted">{w.hebrew}</span>
              </span>
            ))}
          </div>
        </Block>
      )}

      {sentences.length > 0 && (
        <Block title="משפטים שתרגלנו">
          <ul className="surface divide-y divide-line overflow-hidden rounded-2xl">
            {sentences.map((x, i) => (
              <li key={i} className="px-3.5 py-2.5">
                <div dir="ltr" lang="en" className="text-start">{x.en}</div>
                {x.he && <div className="muted text-sm">{x.he}</div>}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {exercises.length > 0 && (
        <Block title="תרגילים שנבדקו" note={correctOf(correct, exercises.length)}>
          <ul className="surface divide-y divide-line overflow-hidden rounded-2xl">
            {exercises.map((e) => (
              <li key={e.id} className="flex items-start gap-2.5 px-3.5 py-3 text-[13px]">
                <div className="min-w-0 flex-1">
                  <div dir="auto" className="text-sm font-medium">{e.question}</div>
                  <div className="muted">
                    תשובה: <span dir="auto">{e.answer || "—"}</span>
                    {e.expected && <> · צפוי: <span dir="auto">{e.expected}</span></>} · ניסיון {e.attempt}
                  </div>
                  <div className="muted text-xs">
                    נבדק ע״י {SOURCE[e.checked_by as keyof typeof SOURCE]}
                    {e.english && <> · <span dir="ltr" lang="en">{e.english}</span></>}
                  </div>
                  <div className="mt-1.5"><ResponseFormatChip format={e.response_format} /></div>
                </div>
                <ResultBadge result={e.result} />
              </li>
            ))}
          </ul>
        </Block>
      )}

      <p className="muted text-center text-xs">
        {fromCoach ? "נשמר על ידי ChatGPT דרך MCP" : "נשמר מהאפליקציה"}
        <span dir="ltr" className="mt-1 block font-mono">id: {s.id}</span>
      </p>
    </>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">{title}</h2>
        {note && <span className="text-[12.5px] text-accent">{note}</span>}
      </div>
      {children}
    </section>
  );
}
