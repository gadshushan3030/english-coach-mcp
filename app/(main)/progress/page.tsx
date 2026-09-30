import Link from "next/link";
import { revokeConnection } from "@/app/actions";
import { sql } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { correctOf, fmtDay, fmtTime, ResultBadge, SCORE_LABELS, ScoreLine, SOURCE, type Scores } from "./ui";

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
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : "–";
  };

  return (
    <>
      <h1 className="text-2xl font-bold">התקדמות</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="תשובות שנבדקו" value={correctOf(checked.correct, checked.total)} hint="בדיקה אמיתית של העוזר או האפליקציה" />
        <Tile label="סימון עצמי בכרטיסיות" value={`${self.know} יודע · ${self.practice} לתרגל`} hint="לא נבדק – הערכה עצמית" />
        <Tile label="שיחות" value={String(sessions.length)} />
        {(Object.keys(SCORE_LABELS) as (keyof typeof SCORE_LABELS)[]).map((k) => (
          <Tile key={k} label={`${SCORE_LABELS[k]} (ממוצע)`} value={avg(k)} hint="10 השיחות האחרונות עם ניקוד" />
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">שיחות</h2>
        <ul className="surface divide-y divide-[var(--border)]">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link href={`/progress/${s.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{s.topic}</span>
                  <span className="muted text-xs">
                    {fmtDay(s.day)} · {s.level} · {SOURCE[s.source as keyof typeof SOURCE]}
                    {s.mode === "voice" && " · קולי"}
                    {!s.completed_at && " · פתוחה"}
                  </span>
                </div>
                <div className="muted text-sm">
                  <ScoreLine scores={s} /> {s.total > 0 && <span>({correctOf(s.correct, s.total)})</span>}
                </div>
              </Link>
            </li>
          ))}
          {!sessions.length && <li className="muted p-4 text-center">עוד אין שיחות</li>}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">תרגילים מחוץ לשיחה</h2>
        <ul className="surface divide-y divide-[var(--border)]">
          {standalone.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 text-sm">
                <div dir="auto" className="font-medium">{e.question}</div>
                <div dir="auto" className="muted">תשובה: {e.answer || "—"}{e.expected && ` · צפוי: ${e.expected}`}</div>
                <div className="muted text-xs">
                  {fmtTime(e.created_at)} · ניסיון {e.attempt}
                  {e.english && ` · ${e.english}`}
                </div>
              </div>
              <ResultBadge result={e.result} />
            </li>
          ))}
          {!standalone.length && <li className="muted p-4 text-center">אין</li>}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">עוזרים מחוברים</h2>
        <ul className="surface divide-y divide-[var(--border)]">
          {connections.map((c) => (
            <li key={c.client_id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div dir="auto" className="font-medium">{c.name || c.client_id}</div>
                <div className="muted text-xs">אושר {fmtTime(c.granted_at)}</div>
              </div>
              <form action={revokeConnection.bind(null, c.client_id)}>
                <button className="btn btn-ghost text-sm">ניתוק</button>
              </form>
            </li>
          ))}
          {!connections.length && <li className="muted p-4 text-center">אין חיבורים</li>}
        </ul>
      </section>
    </>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="surface flex flex-col gap-1 p-4" title={hint}>
      <span className="text-xl font-bold tabular-nums">{value}</span>
      <span className="muted text-xs">{label}</span>
    </div>
  );
}
