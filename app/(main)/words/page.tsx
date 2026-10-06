import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AddWordForm } from "./AddWordForm";
import { WordList, type ManagedWord } from "./WordList";

export default async function WordsPage() {
  const userId = await requireUser();
  const words = await sql<ManagedWord>(
    `select w.id, w.english, w.hebrew, w.example, w.status,
            count(e.id) filter (where e.result = 'correct')::int as correct, count(e.id)::int as attempts
     from words w left join exercises e on e.word_id = w.id
     where w.user_id = $1 and w.archived_at is null
     group by w.id order by w.created_at desc, w.english`,
    [userId],
  );

  return (
    <>
      <h1 className="text-[26px] font-bold">המילים שלי</h1>
      <AddWordForm />
      <WordList words={words} />
    </>
  );
}
