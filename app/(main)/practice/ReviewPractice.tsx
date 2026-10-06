"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { saveReview } from "@/app/practice-actions";
import { Speak } from "@/components/Speak";
import type { ReviewAnswerInput, ReviewPrompt, ReviewResult, ReviewStage } from "@/lib/learning-loop";

const STAGE_LABEL: Record<ReviewStage, string> = { recognition: "זיהוי תשובה", completion: "השלמת משפט", rewrite: "תיקון משפט עצמאי" };

export function ReviewPractice({ reviews: initialReviews, onComplete, maxCount, embedded = false }: {
  reviews: ReviewPrompt[];
  onComplete?: () => void;
  maxCount?: number;
  embedded?: boolean;
}) {
  const [reviews] = useState(() => initialReviews.slice(0, maxCount ?? initialReviews.length));
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState(false);
  const [results, setResults] = useState<ReviewResult[]>([]);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const submitted = useRef<ReviewAnswerInput | null>(null);
  const settled = useRef(false);
  const review = reviews[index];

  function save(choice?: number) {
    if (!review || inFlight.current || settled.current) return;
    if (!submitted.current) {
      if (review.stage !== "recognition" && !answer.trim()) return;
      submitted.current = {
        review_id: review.id, revision: review.revision, request_id: crypto.randomUUID(),
        ...(review.stage === "recognition" ? { selected_index: choice } : { answer: answer.trim() }),
      };
    }
    inFlight.current = true;
    setError(false);
    if (choice !== undefined) setSelected(choice);
    const payload = submitted.current;
    startTransition(async () => {
      try {
        const saved = await saveReview(payload);
        settled.current = true;
        setSelected(saved.selected_index);
        if (saved.stage !== "recognition") setAnswer(saved.answer);
        setResult(saved);
        setResults((previous) => [...previous, saved]);
      } catch {
        setError(true);
      } finally {
        inFlight.current = false;
      }
    });
  }

  function next() {
    if (!settled.current || inFlight.current) return;
    settled.current = false;
    submitted.current = null;
    setAnswer(""); setSelected(null); setResult(null); setError(false);
    setIndex(index + 1);
    if (index + 1 >= reviews.length) onComplete?.();
  }

  if (!review) return <div className="surface flex flex-col gap-3 p-5 text-center" role="status">
    <h2 className="text-lg font-semibold">{reviews.length ? "החזרות נשמרו" : "אין חזרות שממתינות עכשיו"}</h2>
    <p className="muted text-sm">{reviews.length ? `${results.filter((v) => v.result === "correct").length}/${results.length} תשובות התאימו לניסוח שנלמד. לכל נושא נקבע מועד חזרה נוסף.` : "טעויות מהשיחות חוזרות בהדרגה: זיהוי, השלמה ואז משפט שלם."}</p>
    {onComplete && reviews.length === 0 && <button type="button" className="btn" onClick={onComplete}>המשך</button>}
    {!onComplete && <Link href="/practice" className="btn">לתרגול שלי להיום</Link>}
  </div>;

  return <section data-focus={embedded ? undefined : true} className="flex min-w-0 flex-col gap-3.5">
    <header className="flex items-center justify-between gap-3">
      <div><h2 className="text-xl font-bold">חוזרים על מה שלמדת</h2><p className="muted text-sm">{STAGE_LABEL[review.stage]}</p></div>
      <span className="muted text-sm tabular-nums">{index + 1}/{reviews.length}</span>
    </header>
    <div className="surface flex flex-col gap-3 p-4" aria-busy={pending}>
      {review.stage === "completion" ? <>
        <label htmlFor={`review-answer-${review.id}`} className="font-semibold">איזו מילה חסרה?</label>
        <p dir="ltr" lang="en" className="break-words text-start text-lg">{review.prompt}</p>
      </> : <>
        <h3 id={`review-question-${review.id}`} dir="auto" className="break-words font-semibold">{review.question}</h3>
        {review.stage === "rewrite" && <>
          <label htmlFor={`review-answer-${review.id}`} className="text-sm">תקן את משפט הדוגמה במלואו, בלי אפשרויות בחירה.</label>
          <span className="muted text-xs">{review.is_variant ? "דוגמה לתרגול שכתב המאמן" : "המשפט מהשיחה שלך"}</span>
          <p dir="ltr" lang="en" className="break-words text-start text-lg">{review.prompt}</p>
        </>}
      </>}
      {review.stage === "recognition" ? <div role="group" aria-labelledby={`review-question-${review.id}`} className="flex flex-col gap-2">
        {review.choices?.map((choice, i) => <button type="button" key={i} dir="ltr" lang="en" disabled={pending || selected !== null || !!result}
          aria-pressed={selected === i} onClick={() => save(i)}
          className={`min-h-13 min-w-0 break-words rounded-[14px] border px-4 py-3 text-start ${selected === i ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}>{choice}</button>)}
      </div> : <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <input id={`review-answer-${review.id}`} dir="ltr" lang="en" autoComplete="off" autoCapitalize="sentences" maxLength={1000}
          value={answer} disabled={pending || error || !!result} onChange={(event) => setAnswer(event.target.value)}
          className="min-h-13 min-w-0 rounded-xl border border-line bg-surface px-3 text-base" placeholder={review.stage === "completion" ? "Type the missing word" : "Write the complete sentence"} />
        <p className="muted text-xs">הבדיקה משווה לניסוח שנלמד; אותיות גדולות וסימן סיום אינם משנים. ניסוח אחר עשוי להיות תקין גם אם לא יתאים לבדיקה הזו.</p>
        {!result && !error && <button type="submit" className="btn" disabled={pending || !answer.trim()}>בדיקת תשובה</button>}
      </form>}
      {review.source_session_id && <Link href={`/progress/${review.source_session_id}`} className="text-sm text-accent underline">לשיחת המקור</Link>}
    </div>
    <div aria-live="polite" aria-atomic="true">
      {pending && <p className="muted text-sm">שומרים את התשובה…</p>}
      {error && <div className="surface flex flex-col gap-2 p-4"><p className="text-sm text-warn">לא התקבל אישור שמירה. התשובה נשארה כאן כדי לנסות שוב.</p>
        <button type="button" className="btn" disabled={pending} onClick={() => save()}>ניסיון שמירה נוסף</button>
        <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>רענון התרגול</button>
      </div>}
      {result && <div className="surface flex flex-col gap-2 p-4">
        <p className={`font-semibold ${result.result === "correct" ? "text-accent" : "text-warn"}`}>{result.result === "correct" ? "מתאים לניסוח שנלמד!" : "הניסוח שנלמד"}</p>
        <div className="flex flex-wrap items-center gap-2"><p dir="ltr" lang="en" className="min-w-0 flex-1 break-words text-start text-lg">{result.corrected_sentence}</p><Speak text={result.corrected_sentence} /></div>
        <p className="text-sm">{result.explanation_he}</p>
        <p className="muted text-xs">נשמר כ{STAGE_LABEL[result.stage]} · החזרה הבאה: {new Date(result.next_due_at).toLocaleDateString("he-IL")}</p>
      </div>}
    </div>
    {result && <button type="button" className="btn h-14" onClick={next}>{index + 1 === reviews.length ? "סיום החזרות" : "לתרגיל הבא"}</button>}
  </section>;
}
