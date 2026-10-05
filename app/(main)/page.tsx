import Link from "next/link";
import { addStarterWords, logout } from "@/app/actions";
import { Icon } from "@/components/Icon";
import { BOX_DAYS, dialogueForDay } from "@/lib/content";
import { sql, today } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { correctOf, fmtRelDay, ScoreLine, type Scores } from "./progress/ui";

type Coach = Scores & { id: string; topic: string; level: string; mode: string; started_at: Date; correct: number; total: number };

export default async function Home() {
  const userId = await requireUser();
  const day = today();
  const dialogue = dialogueForDay(day);
  const [[counts], boxes, [talk], [coach], [user]] = await Promise.all([
    sql<{ total: number; due: number; tomorrow: number }>(
      `select count(*)::int as total,
              count(*) filter (where due_at <= now())::int as due,
              count(*) filter (where (due_at at time zone 'Asia/Jerusalem')::date
                                     = (now() at time zone 'Asia/Jerusalem')::date + 1)::int as tomorrow
       from words where user_id = $1`,
      [userId],
    ),
    sql<{ box: number; n: number }>("select box, count(*)::int as n from words where user_id = $1 group by box", [userId]),
    sql(
      `select 1 from practice_sessions
       where user_id = $1 and day = $2 and source = 'app' and topic = $3 and completed_at is not null limit 1`,
      [userId, day, dialogue.title],
    ),
    sql<Coach>(
      `select s.id, s.topic, s.level, s.mode, s.started_at, s.comprehension, s.vocabulary, s.grammar, s.pronunciation,
              count(e.id) filter (where e.result = 'correct')::int as correct, count(e.id)::int as total
       from practice_sessions s left join exercises e on e.session_id = s.id
       where s.user_id = $1 and s.source = 'assistant'
       group by s.id order by s.started_at desc limit 1`,
      [userId],
    ),
    sql<{ name: string }>('select name from "user" where id = $1', [userId]),
  ]);

  const header = <Header name={user?.name} />;

  if (!counts.total) {
    return (
      <>
        {header}
        <section className="surface flex flex-col gap-4 p-6">
          <h2 className="text-xl font-bold">ברוכים הבאים</h2>
          <p className="muted">עדיין אין מילים. אפשר להתחיל עם 40 מילים בסיסיות, או להוסיף מילים משלך.</p>
          <div className="flex flex-wrap gap-2">
            <form action={addStarterWords}>
              <button className="btn">הוספת מילים בסיסיות</button>
            </form>
            <Link href="/words" className="btn btn-ghost">הוספה ידנית</Link>
          </div>
        </section>
      </>
    );
  }

  const perBox = BOX_DAYS.map((_, b) => boxes.find((x) => x.box === b)?.n ?? 0);
  const max = Math.max(...perBox);

  return (
    <>
      {header}

      <section className="flex flex-col gap-3.5 rounded-[22px] bg-accent p-5 text-on-accent">
        <div className="flex items-end gap-3">
          <span className="text-6xl leading-[0.9] font-semibold tracking-tight tabular-nums">{counts.due}</span>
          <div className="flex flex-col gap-0.5 pb-1">
            <span className="text-[17px] font-semibold">{counts.due ? "מילים מחכות לחזרה" : "אין חזרות כרגע"}</span>
            {counts.tomorrow > 0 && <span className="text-[13px] text-on-accent/80">ועוד {counts.tomorrow} מחר</span>}
          </div>
        </div>
        {counts.due > 0 && (
          <Link href="/cards" className="flex h-13 items-center justify-center gap-2 rounded-[14px] bg-surface font-semibold text-accent">
            להתחיל חזרה
            <Icon name="forward" size={20} strokeWidth={2} />
          </Link>
        )}
      </section>

      <section className="surface flex flex-col gap-3 px-[18px] pt-4 pb-3.5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">איפה המילים שלך</h2>
          <span className="muted text-[12.5px]">{counts.total} מילים</span>
        </div>
        {/* Box 0 sits on the right (RTL start): reading direction runs from "now" to "60 days". */}
        <div className="grid h-26 grid-cols-7 items-end gap-2">
          {perBox.map((n, b) => (
            <div key={b} className="flex h-full flex-col items-center justify-end gap-1">
              <span className={`text-[13px] font-semibold tabular-nums ${b === 0 ? "text-warn" : ""}`}>{n}</span>
              <div
                className="w-full rounded-md"
                style={{ height: n ? Math.max(4, Math.round((n / max) * 80)) : 0, background: boxColor(b) }}
              />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2 border-t border-line pt-1.5 text-center font-mono text-xs text-muted">
          {BOX_DAYS.map((d, b) => (
            <span key={b} className={b === 0 ? "text-warn" : ""}>{d}</span>
          ))}
        </div>
        <span className="muted text-[12.5px]">ימים עד החזרה הבאה · ״יודע״ מעלה קופסה, ״צריך לתרגל״ מחזיר ל־0</span>
      </section>

      <Link href="/talk" className="surface flex items-center gap-3.5 px-4 py-3.5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon name="chat" size={22} />
        </span>
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="muted text-[12.5px]">שיחה יומית</span>
          <span className="font-semibold">{dialogue.title}</span>
          <span className={`text-[12.5px] ${talk ? "text-accent" : "muted"}`}>
            {talk ? "הושלמה היום" : `${dialogue.turns.length} משפטים · 2 דקות`}
          </span>
        </span>
        <Icon name="forward" size={20} strokeWidth={2} className="text-muted" />
      </Link>

      {coach && (
        <Link href={`/progress/${coach.id}`} className="surface flex flex-col gap-2 px-4 py-3.5">
          <span className="muted flex items-center gap-1.5 text-[12.5px]">
            <Icon name="spark" size={16} className="text-ink" />
            השיחה האחרונה עם המאמן ב־ChatGPT · {fmtRelDay(coach.started_at)}
          </span>
          <span className="flex items-center gap-2">
            <span className="flex-1 font-semibold">{coach.topic}</span>
            <span className="chip font-mono">{coach.level}</span>
            <span className="chip">{coach.mode === "voice" ? "קולי" : "טקסט"}</span>
          </span>
          <span className="muted text-[13px]">
            <ScoreLine scores={coach} />
            {coach.total > 0 && ` · ${correctOf(coach.correct, coach.total)}`}
          </span>
        </Link>
      )}
    </>
  );
}

function boxColor(b: number) {
  return b === 0 ? "var(--warn)" : b <= 2 ? "var(--box-weak)" : b <= 4 ? "var(--box-mid)" : "var(--accent)";
}

function Header({ name }: { name?: string }) {
  const now = new Date();
  const hour = Number(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem", hour: "numeric", hourCycle: "h23" }));
  const greeting = hour >= 5 && hour < 12 ? "בוקר טוב" : hour < 17 && hour >= 12 ? "צהריים טובים" : hour >= 17 && hour < 22 ? "ערב טוב" : "לילה טוב";
  // Password accounts made by create-owner have the email as name; only greet by a real first name.
  const first = name && !name.includes("@") ? name.split(" ")[0] : null;

  return (
    <header className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="muted text-[13px]">
          {now.toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long" })}
        </span>
        <h1 className="text-[26px] font-bold tracking-tight">{first ? `${greeting}, ${first}` : greeting}</h1>
      </div>
      <form action={logout}>
        <button className="muted min-h-11 rounded-xl px-2 text-sm">יציאה</button>
      </form>
    </header>
  );
}
