import Link from "next/link";
import { chooseAdaptiveDialogue, resolveDialogue, nextAdaptiveDialogue } from "@/lib/adaptive-content";
import { readLearnerProfile } from "@/lib/profile-store";
import { sql, today } from "@/lib/db";
import { listPendingQuestions } from "@/lib/question-store";
import { requireUser } from "@/lib/session";
import { Conversation } from "./Conversation";
import { PersonalizedQuiz } from "./PersonalizedQuiz";

export default async function TalkPage({ searchParams }: PageProps<"/talk">) {
  const { d } = await searchParams;
  const day = today();
  const userId = await requireUser();
  const { profile } = await readLearnerProfile(userId);
  const selectedDialogue = typeof d === "string" ? resolveDialogue(d) : undefined;
  const dialogue = selectedDialogue ?? chooseAdaptiveDialogue(day,profile);
  const next = nextAdaptiveDialogue(dialogue.id,profile);
  const [questions, [done]] = await Promise.all([
    listPendingQuestions(userId),
    sql<{ correct: number; total: number }>(
    `select count(e.id) filter (where e.result = 'correct')::int as correct, count(e.id)::int as total
     from practice_sessions s left join exercises e on e.session_id = s.id
     where s.user_id = $1 and s.day = $2 and s.source = 'app' and s.topic = $3 and s.completed_at is not null
     group by s.id order by s.started_at desc limit 1`,
    [userId, day, dialogue.title],
    ),
  ]);

  const conversation = (
    <Conversation key={`${userId}:${day}:${dialogue.id}`} dialogue={dialogue} nextId={next.id} shift={Number(day.replaceAll("-", ""))} doneToday={done ?? null} learnerId={userId} learnerKey={`${userId}:${day}`} />
  );

  if (selectedDialogue) {
    return (
      <>
        {questions.length > 0 && <Link href="/talk" className="btn btn-ghost">לשאלות האישיות · {questions.length} ממתינות</Link>}
        {conversation}
      </>
    );
  }

  return <PersonalizedQuiz initialQuestions={questions} dailyId={dialogue.id} dailyConversation={conversation} />;
}
