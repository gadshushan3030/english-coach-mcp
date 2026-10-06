import Link from "next/link";
import * as z from "zod/v4";
import { requireUser } from "@/lib/session";
import { today } from "@/lib/db";
import { readLearnerProfile } from "@/lib/profile-store";
import { dailyBudget } from "@/lib/learner-profile";
import { listDueWords, dailyConversationResult } from "@/lib/daily-store";
import { listPendingQuestions } from "@/lib/question-store";
import { listDueReviews } from "@/lib/learning-store";
import { chooseAdaptiveDialogue } from "@/lib/adaptive-content";
import { ReviewPractice } from "./ReviewPractice";
import { DailyPractice } from "./DailyPractice";

export default async function PracticePage({ searchParams }: PageProps<"/practice">) {
  const userId = await requireUser();
  const { section, focus } = await searchParams;
  const day = today();
  const { profile, configured } = await readLearnerProfile(userId);
  if (section === "reviews") {
    const focused = z.uuid().safeParse(focus);
    const focusIds = focused.success ? [focused.data] : undefined;
    const reviews = await listDueReviews(userId,{limit:20,focusIds});
    return <section data-focus className="flex flex-col gap-4">
      <ReviewPractice key={`${userId}:${day}:${focusIds?.join(",") ?? "all"}`} reviews={reviews} />
      <Link href="/practice" className="btn btn-ghost">למסלול היומי</Link>
    </section>;
  }
  const budget = dailyBudget(profile.daily_minutes);
  const dialogue = chooseAdaptiveDialogue(day,profile);
  const [words,questions,reviews,doneToday] = await Promise.all([
    listDueWords(userId,budget.words),listPendingQuestions(userId,budget.questions),
    listDueReviews(userId,{limit:budget.reviews}),dailyConversationResult(userId,day,dialogue.title),
  ]);
  return <>
    {!configured && <Link href="/settings" className="surface px-4 py-3 text-sm text-accent">אפשר להתאים את המטרה והרמה לפני שמתחילים ←</Link>}
    <DailyPractice key={`${userId}:${day}:${profile.goal}:${profile.level}:${dialogue.id}:${profile.daily_minutes}`} learnerKey={userId} day={day} profile={profile} words={words} questions={questions} reviews={reviews} dialogue={dialogue} doneToday={doneToday} />
  </>;
}
