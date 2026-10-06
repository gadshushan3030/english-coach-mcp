import * as z from "zod/v4";
import { sql } from "./db";
import { reviewAnswerInput, type ReviewPrompt, type ReviewResult, type ReviewSummary } from "./learning-loop";

const variantText = z.string().trim().min(1).max(500);
export const reviewVariantInput = z.object({
  question: variantText,
  choices: z.array(variantText).length(3).refine((choices) => new Set(choices.map((v) => v.toLowerCase())).size === 3, "Choices must be distinct"),
  correct_index: z.number().int().min(0).max(2),
  explanation_he: variantText.regex(/[\u05d0-\u05ea]/),
  original: variantText,
});

export async function queueReviewVariants(userId: string, questionId: string, variants: unknown) {
  const id = z.uuid().parse(questionId);
  const checked = z.array(reviewVariantInput).max(10).parse(variants);
  await sql("select queue_review_variants($1,$2,$3::jsonb)", [userId, id, JSON.stringify(checked)]);
}

export async function syncPracticeReviews(userId: string) {
  await sql("select sync_practice_reviews($1)", [userId]);
}

export async function listDueReviews(userId: string, options: { limit?: number; focusIds?: string[] } = {}) {
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 20)));
  const focus = options.focusIds?.length ? z.array(z.uuid()).max(100).parse(options.focusIds) : null;
  // A focus list permits intentional extra practice before the next due time.
  // Recognition and completion omit the original. Independent correction needs
  // an erroneous example, while its corrected answer key stays on the server.
  return sql<ReviewPrompt>(
    `select c.id, c.question_id as source_question_id, c.source_session_id, c.revision, c.stage,
       c.question, case when c.stage = 'completion' then gap.prompt when c.stage = 'rewrite' then c.original else c.question end as prompt,
       case when c.stage = 'recognition' then c.choices else null end as choices,
       (c.variant_position > 0) as is_variant,
       c.due_at::text as due_at
     from practice_review_content c
     cross join lateral review_completion(c.corrected_sentence, c.original) gap
     where c.user_id = $1
       and (c.word_id is null or exists (select 1 from words w where w.id = c.word_id and w.user_id = c.user_id and w.archived_at is null))
       and (($3::uuid[] is null and c.due_at <= now()) or c.id = any($3::uuid[]))
     order by c.due_at, c.id limit $2`,
    [userId, limit, focus],
  );
}

export async function getReviewSummary(userId: string) {
  const [summary] = await sql<ReviewSummary>(
    `select count(*)::int as total, count(*) filter (where due_at <= now())::int as due,
       count(*) filter (where stage = 'recognition')::int as recognition,
       count(*) filter (where stage = 'completion')::int as completion,
       count(*) filter (where stage = 'rewrite')::int as rewrite
     from practice_skills s join practice_questions q on q.id = s.question_id and q.user_id = s.user_id
     where s.user_id = $1
       and (q.word_id is null or exists (select 1 from words w where w.id = q.word_id and w.user_id = s.user_id and w.archived_at is null))`, [userId],
  );
  return summary;
}

export async function answerReview(userId: string, input: unknown) {
  const v = reviewAnswerInput.parse(input);
  const [{ id }] = await sql<{ id: string }>("select answer_practice_review($1,$2,$3,$4,$5,$6) as id", [
    userId, v.review_id, v.request_id, v.revision, v.selected_index ?? null, v.answer ?? null,
  ]);
  // Replays return the original checked answer and its original next schedule.
  const [result] = await sql<ReviewResult>(
    `select e.id as exercise_id, a.review_id, a.revision, a.stage, e.result, e.answer, e.expected,
       a.corrected_sentence, a.explanation_he, a.selected_index, a.next_due_at::text as next_due_at,
       a.next_stage, q.source_session_id
     from practice_skill_attempts a join exercises e on e.id = a.exercise_id and e.user_id = a.user_id
     join practice_skills s on s.id = a.review_id and s.user_id = a.user_id
     join practice_questions q on q.id = s.question_id and q.user_id = s.user_id
     where e.id = $1 and a.user_id = $2`, [id, userId],
  );
  if (!result) throw new Error("Practice review answer not found");
  return result;
}
