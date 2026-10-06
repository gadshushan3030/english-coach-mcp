import * as z from "zod/v4";

export const reviewStage = z.enum(["recognition", "completion", "rewrite"]);
export type ReviewStage = z.infer<typeof reviewStage>;

export const reviewAnswerInput = z.object({
  review_id: z.uuid(),
  request_id: z.uuid(),
  revision: z.number().int().min(0),
  selected_index: z.number().int().min(0).max(2).optional(),
  answer: z.string().trim().min(1).max(1000).optional(),
}).refine((v) => (v.selected_index !== undefined) !== (v.answer !== undefined), "Send a choice or typed answer");
export type ReviewAnswerInput = z.infer<typeof reviewAnswerInput>;

// This accepts minor writing conventions, not paraphrases or semantic equivalents.
export function normalizeReviewAnswer(value: string) {
  return value.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").replace(/[.!?]+$/g, "").trim();
}
export function matchesExpected(answer: string, expected: string) {
  return normalizeReviewAnswer(answer) === normalizeReviewAnswer(expected);
}

export function completionFor(expected: string, original: string) {
  const tokens = expected.trim().split(/\s+/);
  const originalTokens = original.trim().split(/\s+/);
  let at = tokens.findIndex((token, i) => normalizeReviewAnswer(token) !== normalizeReviewAnswer(originalTokens[i] ?? ""));
  if (at < 0) at = Math.floor(tokens.length / 2);
  const answer = tokens[at];
  tokens[at] = "_____";
  return { prompt: tokens.join(" "), expected: answer };
}

export function nextReviewState(stage: ReviewStage, correct: boolean, streak: number) {
  if (!correct) return { stage: stage === "rewrite" ? "completion" as const : stage, streak: 0, delayMinutes: 10 };
  if (stage === "recognition") return { stage: "completion" as const, streak: streak + 1, delayMinutes: 24 * 60 };
  if (stage === "completion") return { stage: "rewrite" as const, streak: streak + 1, delayMinutes: 3 * 24 * 60 };
  return { stage, streak: streak + 1, delayMinutes: Math.min(30, 7 * 2 ** Math.min(streak, 3)) * 24 * 60 };
}

// Answer keys and explanations stay on the server. Rewrite uses the erroneous
// example as its task context; completion only exposes a sentence with a gap.
export type ReviewPrompt = {
  id: string;
  source_question_id: string;
  source_session_id: string | null;
  revision: number;
  stage: ReviewStage;
  question: string;
  prompt: string;
  choices: string[] | null;
  is_variant: boolean;
  due_at: string;
};
export type ReviewResult = {
  exercise_id: string;
  review_id: string;
  revision: number;
  stage: ReviewStage;
  result: "correct" | "incorrect";
  answer: string;
  expected: string;
  corrected_sentence: string;
  explanation_he: string;
  selected_index: number | null;
  next_due_at: string;
  next_stage: ReviewStage;
  source_session_id: string | null;
};
export type ReviewSummary = { due: number; total: number; recognition: number; completion: number; rewrite: number };
export type ReviewVariant = {
  question: string;
  choices: string[];
  correct_index: number;
  explanation_he: string;
  original: string;
};
