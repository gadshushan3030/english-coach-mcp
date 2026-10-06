import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Deck } from "./Deck";

export default async function CardsPage() {
  const userId = await requireUser();
  const words = await sql<{ id: string; english: string; hebrew: string; example: string | null; box: number; correct: number; attempts: number }>(
    `select w.id, w.english, w.hebrew, w.example, w.box,
            count(e.id) filter (where e.result = 'correct')::int as correct, count(e.id)::int as attempts
     from words w left join exercises e on e.word_id = w.id
     where w.user_id = $1 and w.archived_at is null and w.due_at <= now()
     group by w.id order by w.due_at limit 20`,
    [userId],
  );

  return (
    <Deck
      words={words.map(({ correct, attempts, ...w }) => ({ ...w, checked: attempts ? { correct, attempts } : undefined }))}
    />
  );
}
