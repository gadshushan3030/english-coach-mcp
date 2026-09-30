import Link from "next/link";
import { revokeConnection } from "@/app/actions";
import { createClient } from "@/lib/supabase";
import { correctOf, fmtDay, fmtTime, ResultBadge, SCORE_LABELS, ScoreLine, SOURCE } from "./ui";

export default async function ProgressPage() {
  const supabase = await createClient();
  const reviews = (knew: boolean) => supabase.from("reviews").select("*", { count: "exact", head: true }).eq("knew", knew);
  const [{ data: sessions }, { data: exercises }, { count: selfKnow }, { count: selfPractice }, { data: grants }] = await Promise.all([
    supabase
      .from("practice_sessions")
      .select("id, day, source, mode, topic, level, completed_at, comprehension, vocabulary, grammar, pronunciation, exercises(result)")
      .order("started_at", { ascending: false })
      .limit(50),
    supabase
      .from("exercises")
      .select("id, session_id, question, answer, expected, result, attempt, created_at, words(english)")
      .order("created_at", { ascending: false }),
    reviews(true),
    reviews(false),
    supabase.auth.oauth.listGrants(),
  ]);

  const all = exercises ?? [];
  const standalone = all.filter((e) => !e.session_id).slice(0, 30);
  const rated = (sessions ?? []).filter((s) => s.comprehension != null).slice(0, 10);
  const avg = (k: keyof typeof SCORE_LABELS) => {
    const v = rated.map((s) => s[k]).filter((x): x is number => x != null);
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : "–";
  };

  return (
    <>
      <h1 className="text-2xl font-bold">התקדמות</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="תשובות שנבדקו" value={correctOf(all)} hint="בדיקה אמיתית של העוזר או האפליקציה" />
        <Tile label="סימון עצמי בכרטיסיות" value={`${selfKnow ?? 0} יודע · ${selfPractice ?? 0} לתרגל`} hint="לא נבדק – הערכה עצמית" />
        <Tile label="שיחות" value={String(sessions?.length ?? 0)} />
        {(Object.keys(SCORE_LABELS) as (keyof typeof SCORE_LABELS)[]).map((k) => (
          <Tile key={k} label={`${SCORE_LABELS[k]} (ממוצע)`} value={avg(k)} hint="10 השיחות האחרונות עם ניקוד" />
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">שיחות</h2>
        <ul className="surface divide-y divide-[var(--border)]">
          {(sessions ?? []).map((s) => (
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
                  <ScoreLine scores={s} /> {s.exercises.length > 0 && <span>({correctOf(s.exercises)})</span>}
                </div>
              </Link>
            </li>
          ))}
          {!sessions?.length && <li className="muted p-4 text-center">עוד אין שיחות</li>}
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
                  {e.words && ` · ${e.words.english}`}
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
          {(grants ?? []).map((g) => (
            <li key={g.client.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div dir="auto" className="font-medium">{g.client.name || g.client.id}</div>
                <div className="muted text-xs">אושר {fmtTime(g.granted_at)}</div>
              </div>
              <form action={revokeConnection.bind(null, g.client.id)}>
                <button className="btn btn-ghost text-sm">ניתוק</button>
              </form>
            </li>
          ))}
          {!grants?.length && <li className="muted p-4 text-center">אין חיבורים</li>}
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
