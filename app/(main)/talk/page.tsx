import Link from "next/link";
import { DIALOGUES, dialogueForDay } from "@/lib/content";
import { sql, today } from "@/lib/db";
import { listPendingQuestions } from "@/lib/question-store";
import { requireOwner } from "@/lib/session";
import { Conversation } from "./Conversation";
import { PersonalizedQuiz } from "./PersonalizedQuiz";

export default async function TalkPage({ searchParams }: PageProps<"/talk">) {
  const { d } = await searchParams;
  const day = today();
  const selectedDialogue = DIALOGUES.find((x) => x.id === d);
  const dialogue = selectedDialogue ?? dialogueForDay(day);
  const next = DIALOGUES[(DIALOGUES.indexOf(dialogue) + 1) % DIALOGUES.length];

  const userId = await requireOwner();
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
    <Conversation key={dialogue.id} dialogue={dialogue} nextId={next.id} shift={Number(day.replaceAll("-", ""))} doneToday={done ?? null} />
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
