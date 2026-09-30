import { DIALOGUES, dialogueForDay } from "@/lib/content";
import { createClient, today } from "@/lib/supabase";
import { Conversation } from "./Conversation";

export default async function TalkPage({ searchParams }: PageProps<"/talk">) {
  const { d } = await searchParams;
  const day = today();
  const dialogue = DIALOGUES.find((x) => x.id === d) ?? dialogueForDay(day);
  const next = DIALOGUES[(DIALOGUES.indexOf(dialogue) + 1) % DIALOGUES.length];

  const supabase = await createClient();
  const { data: done } = await supabase
    .from("practice_sessions")
    .select("exercises(result)")
    .eq("day", day)
    .eq("source", "app")
    .eq("topic", dialogue.title)
    .not("completed_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">{dialogue.title}</h1>
        <p className="muted text-sm">
          {done
            ? `✓ תורגלה היום (${done.exercises.filter((e) => e.result === "correct").length}/${done.exercises.length})`
            : "בחרו את התשובה הטבעית לכל משפט"}
        </p>
      </div>
      <Conversation key={dialogue.id} dialogue={dialogue} nextId={next.id} shift={Number(day.replaceAll("-", ""))} />
    </>
  );
}
