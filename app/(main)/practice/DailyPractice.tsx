"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Deck } from "../cards/Deck";
import { PersonalizedQuiz } from "../talk/PersonalizedQuiz";
import { Conversation } from "../talk/Conversation";
import { ReviewPractice } from "./ReviewPractice";
import { TopBar } from "@/components/TopBar";
import { GOALS, type LearnerProfile } from "@/lib/learner-profile";
import type { DailyWord } from "@/lib/daily-store";
import type { Dialogue } from "@/lib/content";
import type { PendingQuestion } from "@/lib/practice-questions";
import type { ReviewPrompt } from "@/lib/learning-loop";

const PHASE_LABELS = { words: "מילים לחזרה", questions: "מהשיחות שלי", reviews: "יישום התיקונים", conversation: "שיחה קצרה" } as const;
type Phase = keyof typeof PHASE_LABELS;
const CHANGE_EVENT = "english-coach-daily-progress";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(CHANGE_EVENT, callback); };
}
function readCompleted(value: string): Phase[] {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((id): id is Phase => typeof id === "string" && id in PHASE_LABELS) : []; }
  catch { return []; }
}

export function DailyPractice(props: {
  /** Raw authenticated user ID supplied by PracticePage. */
  learnerKey: string; day: string; profile: LearnerProfile; words: DailyWord[];
  questions: PendingQuestion[]; reviews: ReviewPrompt[]; dialogue: Dialogue;
  doneToday: {correct:number;total:number} | null;
}) {
  const [plan] = useState(props);
  const [fallback, setFallback] = useState<Phase[]>([]);
  const storageKey = `english-coach:daily:${plan.learnerKey}:${plan.day}:${plan.profile.goal}:${plan.profile.level}:${plan.dialogue.id}:${plan.profile.daily_minutes}`;
  const stored = useSyncExternalStore(subscribe, () => {
    try { return sessionStorage.getItem(storageKey) ?? "[]"; } catch { return "[]"; }
  }, () => "[]");
  const completed = [...readCompleted(stored),...fallback];
  const phases: Phase[] = [
    ...(plan.words.length ? ["words" as const] : []),
    ...(plan.questions.length ? ["questions" as const] : []),
    ...(plan.reviews.length ? ["reviews" as const] : []),
    ...(plan.doneToday ? [] : ["conversation" as const]),
  ];
  const current = phases.find((phase) => !completed.includes(phase));
  function finish(phase: Phase) {
    const next = [...new Set([...completed,phase])];
    setFallback(next);
    try { sessionStorage.setItem(storageKey,JSON.stringify(next)); window.dispatchEvent(new Event(CHANGE_EVENT)); } catch { /* Continue in memory when storage is unavailable. */ }
  }

  return <section data-focus className="flex flex-col gap-4">
    <TopBar title="התרגול שלי להיום" />
    <header className="flex flex-col gap-1">
      <h1 className="text-[24px] font-bold">{current ? PHASE_LABELS[current] : "השלמת את המסלול היומי"}</h1>
      <p className="muted text-sm">{GOALS[plan.profile.goal]} · רמת פתיחה {plan.profile.level} · יעד של כ־{plan.profile.daily_minutes} דקות</p>
    </header>
    {phases.length > 0 && <ol className="grid grid-cols-2 gap-2" aria-label="שלבי התרגול">
      {phases.map((phase,index) => <li key={phase} aria-current={current === phase ? "step" : undefined} className={`rounded-xl border px-3 py-2 text-sm ${current === phase ? "border-accent bg-accent-soft font-semibold" : "border-line"}`}>
        {completed.includes(phase) ? "✓" : `${index+1}.`} {PHASE_LABELS[phase]}
      </li>)}
    </ol>}
    {current === "words" && <Deck words={plan.words} embedded onComplete={() => finish("words")} />}
    {current === "questions" && <PersonalizedQuiz initialQuestions={plan.questions} dailyId={plan.dialogue.id} dailyConversation={null} embedded onComplete={() => finish("questions")} />}
    {current === "reviews" && <ReviewPractice reviews={plan.reviews} embedded onComplete={() => finish("reviews")} />}
    {current === "conversation" && <Conversation dialogue={plan.dialogue} nextId={plan.dialogue.id} shift={Number(plan.day.replaceAll("-",""))} doneToday={null} learnerId={plan.learnerKey} learnerKey={`${plan.learnerKey}:${plan.day}`} embedded onComplete={() => finish("conversation")} />}
    {!current && <div className="surface flex flex-col gap-3 p-5" role="status">
      <p className="font-semibold">כל התשובות שנענו נשמרו בהתקדמות.</p>
      <p className="muted text-sm">חזרות נוספות יופיעו במועד שלהן. אפשר להמשיך לתרגול נוסף או לחזור מחר.</p>
      <Link href="/progress" className="btn">לראות את ההתקדמות</Link>
      <Link href="/practice?section=reviews" className="btn btn-ghost">חזרות נוספות על טעויות</Link>
      <Link href="/talk" className="btn btn-ghost">שאלות ושיחה נוספת</Link>
      <Link href="/cards" className="btn btn-ghost">עוד מילים לחזרה</Link>
    </div>}
    <p className="muted text-center text-xs">אפשר להמשיך באותה לשונית אחרי רענון. זמני התרגול הם הערכה.</p>
  </section>;
}
