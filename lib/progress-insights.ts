import { sql } from "./db";

export async function getProgressInsights(userId: string) {
  const [mistakes,[retention],[activity]] = await Promise.all([
    sql<{id:string;question:string;explanation_he:string;errors:number;due:boolean}>(
      `select s.id,q.question,q.explanation_he,
        ((case when first.result='incorrect' and first.created_at>=now()-interval '7 days' then 1 else 0 end)
         + count(e.id) filter(where e.result='incorrect' and e.created_at>=now()-interval '7 days'))::int as errors,
        s.due_at<=now() as due
       from practice_skills s join practice_questions q on q.id=s.question_id and q.user_id=s.user_id
       join exercises first on first.id=q.exercise_id
       left join practice_skill_attempts a on a.review_id=s.id and a.user_id=s.user_id
       left join exercises e on e.id=a.exercise_id and e.user_id=s.user_id
       where s.user_id=$1 and (q.word_id is null or exists(
         select 1 from words w where w.id=q.word_id and w.user_id=s.user_id and w.archived_at is null))
       group by s.id,q.id,first.id
       having (case when first.result='incorrect' and first.created_at>=now()-interval '7 days' then 1 else 0 end)
         + count(e.id) filter(where e.result='incorrect' and e.created_at>=now()-interval '7 days') > 0
       order by errors desc,s.due_at limit 3`,[userId],
    ),
    sql<{tested:number;remembered:number}>(
      `with ordered as (
        select e.word_id,e.result,e.created_at,e.id,
          lag(e.created_at) over(partition by e.word_id order by e.created_at,e.id) as previous_at
        from exercises e join words w on w.id=e.word_id and w.user_id=e.user_id
        where e.user_id=$1 and w.archived_at is null
       ), latest as (
        select distinct on(word_id) word_id,result,created_at,previous_at from ordered
        order by word_id,created_at desc,id desc
       ) select count(*)::int as tested,count(*) filter(where result='correct')::int as remembered
       from latest l where l.created_at>=now()-interval '7 days'
       and l.previous_at<=l.created_at-interval '7 days'`,[userId],
    ),
    sql<{days:number;attempts:number;correct:number}>(
      `select count(distinct(created_at at time zone 'Asia/Jerusalem')::date)::int as days,
       count(*)::int as attempts,count(*) filter(where result='correct')::int as correct
       from exercises where user_id=$1 and created_at>=now()-interval '7 days'`,[userId],
    ),
  ]);
  return {mistakes,retention,activity};
}
