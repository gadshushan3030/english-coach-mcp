import * as z from "zod/v4";

export const responseFormat = z.enum(["unspecified", "multiple_choice", "free_response"]);
export const choiceIndex = z.number().int().min(0).max(2);
const text = z.string().trim().min(1).max(500);
export const practiceQuestionInput = z.object({
  request_id: z.string().trim().min(8).max(100),
  question: text.describe("A short English question based on an actual conversation error"),
  choices: z.array(text).length(3).refine(
    (choices) => new Set(choices.map((choice) => choice.toLowerCase())).size === 3,
    "Provide exactly three distinct choices",
  ),
  correct_index: choiceIndex.describe("Zero-based index of the one correct choice"),
  explanation_he: text.regex(/[\u05d0-\u05ea]/, "Include a short explanation in Hebrew"),
  original: text.describe("The learner's actual sentence, not an invented error"),
  source_session_id: z.uuid().optional().describe("The source conversation's practice_id, when available"),
  word: z.string().trim().min(1).max(100).optional().describe("Optional existing deck word; grading updates its review schedule once"),
});
export const questionAnswerInput = z.object({ question_id: z.uuid(), selected_index: choiceIndex });

export type PendingQuestion = {
  id: string;
  question: string;
  choices: string[];
  original: string;
  source_session_id: string | null;
};
export type QuestionResult = {
  exercise_id: string;
  selected_index: number;
  correct_index: number;
  result: "correct" | "incorrect";
  answer: string;
  expected: string;
  explanation_he: string;
};
