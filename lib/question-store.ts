import { sql } from "./db";
import { practiceQuestionInput, questionAnswerInput, type PendingQuestion, type QuestionResult } from "./practice-questions";
import { queueReviewVariants } from "./learning-store";

// Never send the answer key or explanation with unanswered questions.
export async function listPendingQuestions(userId: string, limit = 20) {
  return sql<PendingQuestion>(
    `select id, question, choices, original, source_session_id
     from practice_questions where user_id = $1 and answered_at is null
     order by created_at, id limit $2`,
    [userId, Math.min(100, Math.max(1, limit))],
  );
}

export async function queuePracticeQuestion(userId: string, input: unknown) {
  const q = practiceQuestionInput.parse(input);
  const [{ id }] = await sql<{ id: string }>(
    "select queue_practice_question($1,$2,$3,$4,$5,$6,$7,$8,$9) as id",
    [userId, q.request_id, q.question, JSON.stringify(q.choices), q.correct_index,
      q.explanation_he, q.original, q.source_session_id ?? null, q.word ?? null],
  );
  if (q.review_variants !== undefined) await queueReviewVariants(userId,id,q.review_variants);
  return id;
}

export async function answerQuestion(userId: string, questionId: string, selectedIndex: number) {
  const q = questionAnswerInput.parse({ question_id: questionId, selected_index: selectedIndex });
  const [{ id }] = await sql<{ id: string }>("select answer_practice_question($1,$2,$3) as id", [userId, q.question_id, q.selected_index]);
  // Separate statement sees the function's committed writes and returns the ORIGINAL answer on replay.
  const [result] = await sql<QuestionResult>(
    `select e.id as exercise_id, e.selected_index, q.correct_index, e.result,
            e.answer, e.expected, q.explanation_he
     from exercises e join practice_questions q on q.id = e.question_id and q.user_id = e.user_id
     where e.id = $1 and e.user_id = $2`,
    [id, userId],
  );
  if (!result) throw new Error("Answer not found");
  return result;
}
