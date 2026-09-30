import Link from "next/link";
import { addStarterWords } from "@/app/actions";
import { dialogueForDay } from "@/lib/content";
import { sql, today } from "@/lib/db";
import { requireOwner } from "@/lib/session";

export default async function Home() {
  const userId = await requireOwner();
  const day = today();
  const dialogue = dialogueForDay(day);
  const [[{ total, known, due }], [talk]] = await Promise.all([
    sql<{ total: number; known: number; due: number }>(
      `select count(*)::int as total,
              count(*) filter (where status = 'known')::int as known,
              count(*) filter (where due_at <= now())::int as due
       from words where user_id = $1`,
      [userId],
    ),
    sql(
      `select 1 from practice_sessions
       where user_id = $1 and day = $2 and source = 'app' and topic = $3 and completed_at is not null limit 1`,
      [userId, day, dialogue.title],
    ),
  ]);
  const talkedToday = !!talk;

  if (!total) {
    return (
      <section className="surface flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-bold">ברוכים הבאים 👋</h1>
        <p className="muted">עדיין אין מילים. אפשר להתחיל עם 40 מילים בסיסיות, או להוסיף מילים משלך.</p>
        <div className="flex flex-wrap gap-2">
          <form action={addStarterWords}>
            <button className="btn">הוספת מילים בסיסיות</button>
          </form>
          <Link href="/words" className="btn btn-ghost">הוספה ידנית</Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold">היום</h1>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="לחזרה עכשיו" value={due} />
        <Stat label="ידועות" value={known} />
        <Stat label="סה״כ מילים" value={total} />
      </div>
      <Link href="/cards" className="surface flex items-center justify-between p-5">
        <div>
          <div className="text-lg font-semibold">כרטיסיות</div>
          <div className="muted text-sm">{due ? `${due} מילים מחכות לחזרה` : "אין חזרות כרגע — כל הכבוד!"}</div>
        </div>
        <span className="text-2xl">←</span>
      </Link>
      <Link href="/talk" className="surface flex items-center justify-between p-5">
        <div>
          <div className="text-lg font-semibold">שיחה יומית: {dialogue.title}</div>
          <div className="muted text-sm">{talkedToday ? "✓ הושלמה היום" : "3 משפטים, 2 דקות"}</div>
        </div>
        <span className="text-2xl">←</span>
      </Link>
      <Link href="/progress" className="surface flex items-center justify-between p-5">
        <div>
          <div className="text-lg font-semibold">התקדמות</div>
          <div className="muted text-sm">כל השיחות והתרגילים, כולל אלה של העוזר</div>
        </div>
        <span className="text-2xl">←</span>
      </Link>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface flex flex-col items-center gap-1 p-4">
      <span className="text-3xl font-bold tabular-nums">{value}</span>
      <span className="muted text-xs">{label}</span>
    </div>
  );
}
