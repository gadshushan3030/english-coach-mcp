import { sql } from "./db";

export type DailyWord = { id: string; english: string; hebrew: string; example: string | null; box: number; checked?: { correct: number; attempts: number } };

export async function listDueWords(userId: string, limit: number): Promise<DailyWord[]> {
  const rows = await sql<DailyWord & { correct: number; attempts: number }>(
    `select w.id,w.english,w.hebrew,w.example,w.box,
       count(e.id) filter(where e.result='correct')::int as correct,count(e.id)::int as attempts
     from words w left join exercises e on e.word_id=w.id and e.user_id=w.user_id
     where w.user_id=$1 and w.archived_at is null and w.due_at<=now()
     group by w.id order by w.due_at,w.id limit $2`, [userId,Math.min(20,Math.max(1,limit))],
  );
  return rows.map(({correct,attempts,...word}) => ({...word,checked:attempts ? {correct,attempts} : undefined}));
}

export async function dailyConversationResult(userId: string, day: string, topic: string) {
  const [result] = await sql<{ correct: number; total: number }>(
    `select count(e.id) filter(where e.result='correct')::int as correct,count(e.id)::int as total
     from practice_sessions s left join exercises e on e.session_id=s.id
     where s.user_id=$1 and s.day=$2 and s.source='app' and s.topic=$3 and s.completed_at is not null
     group by s.id order by s.started_at desc limit 1`,[userId,day,topic],
  );
  return result ?? null;
}
