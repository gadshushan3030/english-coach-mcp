"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { reviewWordOnce } from "@/app/word-actions";
import { Icon } from "@/components/Icon";
import { Speak } from "@/components/Speak";
import { TopBar } from "@/components/TopBar";
import { BOX_DAYS } from "@/lib/content";

export type Word = { id: string; english: string; hebrew: string; example: string | null; box: number; checked?: { correct: number; attempts: number } };

const FAMILIARITY = ["היכרות חדשה", "היכרות ראשונית", "היכרות מתפתחת", "היכרות מתבססת", "היכרות טובה", "היכרות חזקה", "היכרות לאורך זמן"];

// What each self-assessment does to the schedule, mirroring review_word_once().
function knowLabel(box: number) {
  const next = Math.min(box + 1, 6);
  const days = BOX_DAYS[next];
  const when = days === 1 ? "מחר" : `בעוד ${days} ימים`;
  return `חזרה הבאה ${when}`;
}

export function Deck({ words, onComplete, embedded = false }: { words: Word[]; onComplete?: () => void; embedded?: boolean }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [practice, setPractice] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submission = useRef<{ wordId: string; knew: boolean; requestId: string } | null>(null);
  const saving = useRef(false);
  const n = words.length;

  if (n === 0) {
    return (
      <>
        {!embedded && <TopBar title="חזרה יומית" />}
        <section className="surface flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-lg font-semibold">אין מילים לחזרה כרגע</p>
          <p className="muted text-sm">המילים יחזרו כשיגיע הזמן שלהן.</p>
          {onComplete ? <button className="btn" onClick={onComplete}>להמשך התרגול</button> : <Link href="/words" className="btn btn-ghost">הוספת מילים</Link>}
        </section>
      </>
    );
  }

  if (i >= n) {
    return (
      <>
        {!embedded && <TopBar title="חזרה יומית" end={`${n}/${n}`} />}
        <section className="surface flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-2xl font-bold">סיימת סבב</p>
          <p className="muted">
            <span className="text-accent">{n - practice} ידועות</span> · <span className="text-warn">{practice} לתרגול</span>
          </p>
          {/* Full reload so the deck starts fresh with whatever is due now */}
          <p className="muted text-sm">הסימונים מבטאים את ההערכה שלך לזכירה.</p>
          {onComplete ? <button className="btn" onClick={onComplete}>להמשך התרגול</button> : <>
            {practice > 0 && <a href="/cards" className="btn">סבב נוסף</a>}
            {/* Completing a round needs fresh server counts without replacing the live deck during each mark. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="btn btn-ghost">לדף הבית</a>
          </>}
        </section>
      </>
    );
  }

  const w = words[i];
  const mark = (knew: boolean) => {
    if (saving.current) return;
    saving.current = true;
    startTransition(async () => {
      try {
        if (!submission.current || submission.current.wordId !== w.id) {
          submission.current = { wordId: w.id, knew, requestId: crypto.randomUUID() };
        }
        const attempt = submission.current;
        const result = await reviewWordOnce(attempt.wordId, attempt.knew, attempt.requestId);
        setError(null);
        submission.current = null;
        if (!result.knew) setPractice((p) => p + 1);
        setFlipped(false);
        setI(i + 1);
      } catch {
        setError("השמירה לא אושרה. הסימון נשמר כאן ואפשר לנסות שוב.");
      } finally {
        saving.current = false;
      }
    });
  };

  return (
    <section data-focus className={`flex flex-col gap-3.5 ${embedded ? "min-h-[45dvh]" : "min-h-[calc(100dvh-3.5rem)]"}`}>
      {!embedded && <TopBar title="חזרה יומית" end={`${i + 1}/${n}`} />}
      <div
        role="progressbar"
        aria-label="התקדמות בסבב"
        aria-valuenow={i}
        aria-valuemin={0}
        aria-valuemax={n}
        className="flex h-1.5 overflow-hidden rounded-full bg-line"
      >
        <div className="rounded-full bg-accent transition-[width]" style={{ width: `${(i / n) * 100}%` }} />
      </div>

      <div className="surface flex flex-1 flex-col rounded-[26px] p-[18px]">
        <div className="flex items-center justify-between">
          <span className="chip text-muted" title="רמת היכרות לצורך תזמון החזרות">{FAMILIARITY[w.box] ?? FAMILIARITY[0]}</span>
          {w.checked && (
            <span title="תשובות שנבדקו בפועל, לא סימון עצמי" className="chip bg-accent-soft font-medium text-accent">
              <Icon name="check" size={14} strokeWidth={2.2} />
              נבדק: {w.checked.correct}/{w.checked.attempts} נכונות
            </span>
          )}
        </div>

        {flipped ? (
          <div className="flex flex-1 flex-col justify-center gap-4 px-1 py-2">
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <span dir="ltr" lang="en" className="text-[34px] font-semibold tracking-tight">{w.english}</span>
              <Speak text={w.english} label="השמעת המילה" />
            </div>
            <div className="h-px bg-line" />
            <span className="text-center text-[34px] font-bold">{w.hebrew}</span>
            {w.example && (
              <div className="flex flex-wrap items-center gap-2.5 rounded-[14px] bg-ground px-3.5 py-3">
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="muted text-xs">דוגמה</span>
                  <span dir="ltr" lang="en" className="text-start text-lg">{w.example}</span>
                </span>
                <Speak text={w.example} label="השמעת המשפט" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3.5">
            <span dir="ltr" lang="en" className="text-center text-[46px] leading-tight font-semibold tracking-tight">{w.english}</span>
            <Speak text={w.english} large />
          </div>
        )}
        {!flipped && <span className="muted text-center text-[13.5px]">קודם להיזכר בתרגום, אחר כך לבדוק</span>}
      </div>

      {error && <div className="surface grid gap-2 p-3 text-center">
        <p role="alert" className="text-sm text-warn">{error}</p>
        <button className="btn btn-ghost" disabled={pending} onClick={() => mark(submission.current?.knew ?? false)}>{pending ? "שומר…" : "ניסיון שמירה נוסף"}</button>
      </div>}

      {flipped ? (
        <div className="grid grid-cols-2 gap-2.5">
          <button
            className="flex h-19 flex-col items-center justify-center gap-0.5 rounded-2xl bg-warn text-on-accent disabled:opacity-50"
            disabled={pending || !!error}
            onClick={() => mark(false)}
          >
            <span className="text-[17px] font-semibold">צריך לתרגל</span>
            <span className="text-xs">חזרה נוספת היום</span>
          </button>
          <button
            className="flex h-19 flex-col items-center justify-center gap-0.5 rounded-2xl bg-accent text-on-accent disabled:opacity-50"
            disabled={pending || !!error}
            onClick={() => mark(true)}
          >
            <span className="flex items-center gap-1.5 text-[17px] font-semibold">
              <Icon name="check" size={18} strokeWidth={2.2} />
              יודע
            </span>
            <span className="text-xs">{knowLabel(w.box)}</span>
          </button>
        </div>
      ) : (
        <button className="btn h-14 rounded-2xl text-[17px]" onClick={() => setFlipped(true)}>
          הצגת התרגום
        </button>
      )}
    </section>
  );
}
