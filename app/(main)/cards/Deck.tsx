"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { reviewWord } from "@/app/actions";
import { Speak } from "@/components/Speak";

type Word = { id: string; english: string; hebrew: string; example: string | null; checked?: { correct: number; attempts: number } };

export function Deck({ words }: { words: Word[] }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [practice, setPractice] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (words.length === 0) {
    return (
      <section className="surface flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-lg font-semibold">אין מילים לחזרה כרגע</p>
        <Link href="/words" className="btn btn-ghost">הוספת מילים</Link>
      </section>
    );
  }

  if (i >= words.length) {
    return (
      <section className="surface flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-2xl font-bold">סיימת סבב 🎉</p>
        <p className="muted">
          {words.length - practice} ידועות · {practice} לתרגול
        </p>
        {/* Full reload so the deck starts fresh with whatever is due now */}
        {practice > 0 && <a href="/cards" className="btn">סבב נוסף</a>}
        <Link href="/" className="btn btn-ghost">לדף הבית</Link>
      </section>
    );
  }

  const w = words[i];
  const mark = (knew: boolean) =>
    startTransition(async () => {
      try {
        await reviewWord(w.id, knew);
        setError(null);
        if (!knew) setPractice((p) => p + 1);
        setFlipped(false);
        setI(i + 1);
      } catch {
        setError("השמירה נכשלה. אפשר לנסות שוב.");
      }
    });

  return (
    <section className="flex flex-col gap-4">
      <div className="muted flex justify-between text-sm">
        <span>
          {i + 1} מתוך {words.length}
        </span>
        {w.checked && (
          <span title="תשובות שנבדקו בפועל (לא סימון עצמי)">
            נבדק: {w.checked.correct}/{w.checked.attempts} נכונות
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setFlipped(!flipped)}
        className="surface flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <span dir="ltr" lang="en" className="text-4xl font-bold">{w.english}</span>
        {flipped ? (
          <>
            <span className="text-2xl">{w.hebrew}</span>
            {w.example && <span dir="ltr" lang="en" className="muted text-lg">{w.example}</span>}
          </>
        ) : (
          <span className="muted text-sm">הקשה להצגת התרגום</span>
        )}
      </button>
      <div className="flex justify-center">
        <Speak text={flipped && w.example ? w.example : w.english} />
      </div>
      {error && <p role="alert" className="text-center text-sm text-[var(--bad)]">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <button className="btn bg-[var(--warn)]" disabled={pending} onClick={() => mark(false)}>צריך לתרגל</button>
        <button className="btn bg-[var(--good)]" disabled={pending} onClick={() => mark(true)}>יודע ✓</button>
      </div>
    </section>
  );
}
