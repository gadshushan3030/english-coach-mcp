import Link from "next/link";
import { Fragment } from "react";
import { revokeConnection } from "@/app/actions";
import { Icon } from "@/components/Icon";
import { sql } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { fmtDay, fmtTime, Meter, ResultBadge, SCORE_LABELS, SourceChip, type Scores } from "./ui";

type Session = Scores & {
  id: string;
  day: string;
  source: string;
  mode: string;
  topic: string;
  level: string;
  completed_at: Date | null;
  correct: number;
  total: number;
};

export default async function ProgressPage() {
  const userId = await requireOwner();
  const [sessions, [checked], [self], standalone, connections] = await Promise.all([
    sql<Session>(
      `select s.id, s.day, s.source, s.mode, s.topic, s.level, s.completed_at,
              s.comprehension, s.vocabulary, s.grammar, s.pronunciation,
              count(e.id) filter (where e.result = 'correct')::int as correct, count(e.id)::int as total
       from practice_sessions s left join exercises e on e.session_id = s.id
       where s.user_id = $1 group by s.id order by s.started_at desc limit 50`,
      [userId],
    ),
    sql<{ correct: number; total: number }>(
      `select count(*) filter (where result = 'correct')::int as correct, count(*)::int as total from exercises where user_id = $1`,
      [userId],
    ),
    sql<{ know: number; practice: number }>(
      `select count(*) filter (where knew)::int as know, count(*) filter (where not knew)::int as practice from reviews where user_id = $1`,
      [userId],
    ),
    sql<{ id: string; question: string; answer: string; expected: string | null; result: string; attempt: number; created_at: Date; english: string | null }>(
      `select e.id, e.question, e.answer, e.expected, e.result, e.attempt, e.created_at, w.english
       from exercises e left join words w on w.id = e.word_id
       where e.user_id = $1 and e.session_id is null order by e.created_at desc limit 30`,
      [userId],
    ),
    sql<{ client_id: string; name: string | null; granted_at: Date }>(
      `select c."clientId" as client_id, c.name, cs."createdAt" as granted_at
       from "oauthConsent" cs join "oauthClient" c on c."clientId" = cs."clientId"
       where cs."userId" = $1 order by cs."createdAt" desc`,
      [userId],
    ),
  ]);

  const rated = sessions.filter((s) => s.comprehension != null).slice(0, 10);
  const avg = (k: keyof typeof SCORE_LABELS) => {
    const v = rated.map((s) => s[k]).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const selfTotal = self.know + self.practice;

  return (
    <>
      <header className="flex flex-col gap-0.5">
        <h1 className="text-[26px] font-bold">התקדמות</h1>
        <p className="muted text-[13px]">כל השיחות והתרגילים, מהאפליקציה ומהמאמן</p>
      </header>

      <section className="surface flex flex-col gap-3.5 px-[18px] py-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-semibold">מה אמרת מול מה נבדק</h2>
          <p className="muted text-[12.5px]">שני מקורות נפרדים, אחד ליד השני</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2 rounded-[14px] border border-dashed border-muted/60 p-3">
            <span className="muted text-[12.5px] font-semibold">סימון עצמי</span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold tabular-nums">{self.know}</span>
              <span className="text-[13px]">יודע</span>
            </span>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-track">
              {selfTotal > 0 && (
                <>
                  <div style={{ width: `${(self.know / selfTotal) * 100}%`, background: "var(--box-mid)" }} />
                  <div className="flex-1 bg-warn" />
                </>
              )}
            </div>
            <span className="muted text-xs">{self.practice} ״צריך לתרגל״ · מהכרטיסיות, לא נבדק</span>
          </div>
          <div className="flex flex-col gap-2 rounded-[14px] bg-accent-soft p-3">
            <span className="text-[12.5px] font-semibold text-accent">נבדק בפועל</span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold text-accent tabular-nums">
                {checked.correct}/{checked.total}
              </span>
              <span className="text-[13px]">נכונות</span>
            </span>
            <div className="flex h-2 overflow-hidden rounded-full bg-surface">
              <div className="bg-accent" style={{ width: `${checked.total ? (checked.correct / checked.total) * 100 : 0}%` }} />
            </div>
            <span className="text-xs">תשובות שהמאמן או האפליקציה בדקו</span>
          </div>
        </div>
      </section>

      {rated.length > 0 && (
        <section className="surface flex flex-col gap-3 px-[18px] py-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-semibold">ניקוד ממוצע</h2>
            <p className="muted text-[12.5px]">{rated.length} השיחות האחרונות עם ניקוד, מתוך 5</p>
          </div>
          <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-2.5 text-sm">
            {(Object.keys(SCORE_LABELS) as (keyof typeof SCORE_LABELS)[]).map((k) => {
              const v = avg(k);
              return (
                <Fragment key={k}>
                  <span className="flex flex-col">
                    {SCORE_LABELS[k]}
                    {k === "pronunciation" && <span className="muted text-[11.5px]">בשיחות קוליות</span>}
                  </span>
                  {v == null ? <span className="muted text-xs">אין עדיין</span> : <Meter value={v} />}
                  <span className="text-end font-mono text-[13px]">{v == null ? "–" : v.toFixed(1)}</span>
                </Fragment>
              );
            })}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">שיחות</h2>
          <span className="muted text-[12.5px]">{sessions.length} בסך הכול</span>
        </div>
        <ul className="surface divide-y divide-line overflow-hidden">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link href={`/progress/${s.id}`} className="flex items-center gap-2.5 px-4 py-3">
                <span className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[15px] font-semibold">{s.topic}</span>
                  <span className="muted flex flex-wrap items-center gap-1.5 text-xs">
                    <SourceChip source={s.source} />
                    <span className="chip font-mono">{s.level}</span>
                    {s.source === "assistant" && <span className="chip">{s.mode === "voice" ? "קולי" : "טקסט"}</span>}
                    {!s.completed_at && <span className="chip bg-warn-soft text-warn">פתוחה</span>}
                    <span>{fmtDay(s.day)}</span>
                  </span>
                </span>
                <span className={`font-mono text-[13px] ${s.total ? "text-accent" : "muted"}`}>{s.total ? `${s.correct}/${s.total}` : "—"}</span>
                <Icon name="forward" size={18} strokeWidth={2} className="text-muted" />
              </Link>
            </li>
          ))}
          {!sessions.length && <li className="muted p-4 text-center">עוד אין שיחות</li>}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">תרגילים מחוץ לשיחה</h2>
        <ul className="surface divide-y divide-line overflow-hidden">
          {standalone.map((e) => (
            <li key={e.id} className="flex items-start gap-2.5 px-4 py-3">
              <div className="min-w-0 flex-1 text-[13px]">
                <div dir="auto" className="text-sm font-medium">{e.question}</div>
                <div dir="auto" className="muted">תשובה: {e.answer || "—"}{e.expected && ` · צפוי: ${e.expected}`}</div>
                <div className="muted text-xs">
                  ניסיון {e.attempt} · {fmtTime(e.created_at)}
                  {e.english && <> · <span dir="ltr" lang="en">{e.english}</span></>}
                </div>
              </div>
              <ResultBadge result={e.result} />
            </li>
          ))}
          {!standalone.length && <li className="muted p-4 text-center">אין</li>}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">עוזרים מחוברים</h2>
        <ul className="flex flex-col gap-2">
          {connections.map((c) => (
            <li key={c.client_id} className="surface flex items-center gap-3 px-4 py-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink text-surface">
                <Icon name="spark" size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <div dir="auto" className="font-semibold">{c.name || c.client_id}</div>
                <div className="muted text-xs">אושר {fmtTime(c.granted_at)}</div>
              </div>
              <form action={revokeConnection.bind(null, c.client_id)}>
                <button className="h-11 rounded-xl border border-warn px-4 text-sm font-semibold text-warn">ניתוק</button>
              </form>
            </li>
          ))}
          {!connections.length && <li className="surface muted p-4 text-center">אין חיבורים</li>}
        </ul>
        {connections.length > 0 && <p className="muted text-xs">ניתוק חוסם את העוזר מיד, כבר בבקשה הבאה.</p>}
      </section>
    </>
  );
}
