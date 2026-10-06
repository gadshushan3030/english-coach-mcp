"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { answerPracticeQuestion } from "@/app/actions";
import { Icon } from "@/components/Icon";
import { TopBar } from "@/components/TopBar";
import type { PendingQuestion, QuestionResult } from "@/lib/practice-questions";

export function PersonalizedQuiz({
  initialQuestions,
  dailyId,
  dailyConversation,
  onComplete,
  embedded = false,
}: {
  initialQuestions: PendingQuestion[];
  dailyId: string;
  dailyConversation: ReactNode;
  onComplete?: () => void;
  embedded?: boolean;
}) {
  // Keep this run stable when a saved answer revalidates the server page.
  // A reload starts a new snapshot containing only the questions still pending.
  const [questions] = useState(initialQuestions);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<QuestionResult | null>(null);
  const [results, setResults] = useState<QuestionResult[]>([]);
  const [saveError, setSaveError] = useState(false);
  const [previouslySaved, setPreviouslySaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const attempted = useRef<number | null>(null);
  const settled = useRef(false);
  const question = questions[index];

  function save(choice: number) {
    // Refs close the gap before React renders disabled buttons, including retries.
    if (!question || inFlight.current || settled.current) return;
    if (attempted.current !== null && attempted.current !== choice) return;
    inFlight.current = true;
    attempted.current = choice;
    setSelected(choice);
    setSaveError(false);
    startTransition(async () => {
      try {
        const saved = await answerPracticeQuestion(question.id, choice);
        settled.current = true;
        // Another tab or a retried request may already have saved a different choice.
        setSelected(saved.selected_index);
        setPreviouslySaved(saved.selected_index !== choice);
        setResult(saved);
        setResults((previous) => [...previous, saved]);
      } catch {
        setSaveError(true);
      } finally {
        inFlight.current = false;
      }
    });
  }

  function advance() {
    if (!settled.current || inFlight.current) return;
    settled.current = false;
    attempted.current = null;
    setSelected(null);
    setResult(null);
    setSaveError(false);
    setPreviouslySaved(false);
    setIndex(index + 1);
  }

  if (questions.length === 0) {
    return (
      <>
        <div className="surface flex flex-col gap-1.5 px-4 py-3.5">
          <h2 className="font-semibold">אין כרגע שאלות אישיות להשלמה</h2>
          <p className="muted text-sm">שאלות אישיות יופיעו כאן כשהמאמן ישמור שאלות מהשיחות שלכם. בינתיים אפשר לתרגל את השיחה היומית.</p>
        </div>
        {dailyConversation}
      </>
    );
  }

  const correct = results.filter((answer) => answer.result === "correct").length;

  return (
    <section data-focus className="flex flex-col gap-3.5">
      {!embedded && <TopBar title="תרגול אישי" end={`${Math.min(index + 1, questions.length)}/${questions.length}`} />}
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-bold">מהשיחות שלך</h1>
        <p className="muted text-[13px]">בחירה מתוך 3 · זיהוי תשובה</p>
        <p className="muted text-sm">מתרגלים זיהוי של הניסוח המתאים. ניסוח עצמאי נבדק בנפרד בשיחה עם המאמן.</p>
      </header>

      {question ? (
        <>
          <div className="surface flex flex-col gap-2 px-4 py-3.5">
            <span className="muted text-xs font-semibold">המשפט מהשיחה</span>
            <p dir="ltr" lang="en" className="text-start text-base">{question.original}</p>
            {question.source_session_id && (
              <Link href={`/progress/${question.source_session_id}`} className="self-start text-sm font-semibold text-accent underline underline-offset-4">לשיחת המקור</Link>
            )}
          </div>

          <div className="flex flex-col gap-2" aria-busy={pending}>
            <h2 id="personalized-question" dir="auto" className="text-base font-semibold">{question.question}</h2>
            <div role="group" aria-labelledby="personalized-question" className="flex flex-col gap-2">
              {question.choices.map((choice, choiceIndex) => {
                const mine = selected === choiceIndex;
                const right = result?.correct_index === choiceIndex;
                const state = result
                  ? right
                    ? "border-2 border-accent bg-accent-soft"
                    : mine
                      ? "border-2 border-warn bg-warn-soft"
                      : "border border-line bg-surface text-muted"
                  : mine
                    ? "border-2 border-accent bg-accent-soft"
                    : "border border-line bg-surface";
                return (
                  <button
                    key={choiceIndex}
                    type="button"
                    dir="ltr"
                    lang="en"
                    aria-pressed={mine}
                    disabled={selected !== null || pending}
                    onClick={() => save(choiceIndex)}
                    className={`flex min-h-13 items-center gap-2.5 rounded-[14px] px-4 py-3 text-start text-base ${state}`}
                  >
                    <span className="flex-1">{choice}</span>
                    {result && right && <Icon name="check" size={18} strokeWidth={2.4} className="text-accent" />}
                    {mine && (
                      <span dir="rtl" lang="he" className="text-xs font-semibold">{result ? "הבחירה שנשמרה" : "בחרת"}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div aria-live="polite" aria-atomic="true">
            {pending && <p className="muted text-sm">שומרים את הבחירה…</p>}
            {saveError && (
              <div className="flex flex-col gap-2 rounded-[14px] bg-warn-soft p-3.5">
                <p className="text-sm text-warn">לא התקבל אישור שמירה. הבחירה נשארה מסומנת; אפשר לנסות לשמור אותה שוב.</p>
                <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => selected !== null && save(selected)}>ניסיון שמירה נוסף</button>
              </div>
            )}
            {result && (
              <div className="surface flex flex-col gap-2 rounded-[14px] px-3.5 py-3">
                <p className={`text-sm font-semibold ${result.result === "correct" ? "text-accent" : "text-warn"}`}>
                  {result.result === "correct" ? "נכון!" : "התשובה המתאימה"}
                </p>
                <p dir="ltr" lang="en" className="text-start text-base font-semibold">{result.expected}</p>
                <p dir="rtl" lang="he" className="text-sm leading-relaxed">{result.explanation_he}</p>
                {previouslySaved && <p className="muted text-xs">כבר נשמרה תשובה לשאלה הזו. מוצגת הבחירה שנשמרה.</p>}
                <p className="muted text-xs">נשמר בהתקדמות כזיהוי תשובה</p>
              </div>
            )}
          </div>

          {result && <button type="button" className="btn h-14 rounded-2xl text-[17px]" onClick={advance}>{index + 1 === questions.length ? "סיום" : "לשאלה הבאה"}</button>}
        </>
      ) : (
        <div className="surface flex flex-col items-center gap-3 p-6 text-center" role="status">
          <h2 className="text-lg font-semibold">סיימת את מקבץ השאלות</h2>
          <p className="text-3xl font-bold tabular-nums">{correct}/{results.length}</p>
          <p className="muted text-sm">תשובות נכונות בזיהוי · כל הבחירות נשמרו בהתקדמות</p>
          <p className="muted text-sm">אפשר לבדוק אם ממתינות שאלות נוספות. המאמן יוכל להוסיף שאלות גם מהשיחות הבאות שלכם.</p>
          {onComplete ? <button type="button" className="btn" onClick={onComplete}>להמשך התרגול</button> : <>
            <button type="button" className="btn" onClick={() => window.location.reload()}>בדיקת שאלות נוספות</button>
            <Link href="/practice?section=reviews" className="btn btn-ghost">לחזרות על הטעויות שלי</Link>
            <Link href="/progress" className="btn btn-ghost">להתקדמות</Link>
          </>}
        </div>
      )}

      {!embedded && <Link href={`/talk?d=${dailyId}`} className="btn btn-ghost">מעבר לשיחה היומית</Link>}
      {question && <p className="muted text-center text-xs">כל בחירה נשמרת לפני שממשיכים. בחזרה לתרגול יופיעו השאלות שעוד לא נענו.</p>}
    </section>
  );
}
