import assert from "node:assert/strict";
import test from "node:test";
import { practiceQuestionInput, questionAnswerInput } from "../lib/practice-questions";

const question = {
  request_id: "conversation-error-1",
  question: "Which sentence is correct?",
  original: "I want to listening podcast",
  choices: ["I want to listening podcast", "I want to listen to podcasts", "I want listen podcasts"],
  correct_index: 1,
  explanation_he: "אחרי want משתמשים ב־to ובפועל הבסיסי. אחרי listen מוסיפים to.",
};
test("valid conversation-derived question is trimmed and accepted", () => {
  assert.equal(practiceQuestionInput.parse({ ...question, original: ` ${question.original} ` }).original, question.original);
});
for (const [name, patch] of Object.entries({
  "too few choices": { choices: ["a", "b"] },
  "too many choices": { choices: ["a", "b", "c", "d"] },
  "duplicate choices": { choices: ["Yes", " yes ", "No"] },
  "blank choice": { choices: ["a", " ", "c"] },
  "negative index": { correct_index: -1 },
  "out of range index": { correct_index: 3 },
  "fractional index": { correct_index: 0.5 },
  "blank original": { original: " " },
  "missing Hebrew": { explanation_he: "Use the infinitive" },
  "invalid source": { source_session_id: "someone-else" },
})) {
  test(`rejects ${name}`, () => assert.equal(practiceQuestionInput.safeParse({ ...question, ...patch }).success, false));
}
test("answers require only a UUID and a valid integer selection", () => {
  const id = "b2a9d627-a80f-466c-b8b1-28bc7b0d46cb";
  for (const selected_index of [0, 1, 2]) assert.equal(questionAnswerInput.safeParse({ question_id: id, selected_index }).success, true);
  for (const selected_index of [-1, 3, 1.5, "1", null, NaN]) assert.equal(questionAnswerInput.safeParse({ question_id: id, selected_index }).success, false);
  assert.equal(questionAnswerInput.safeParse({ question_id: "invalid", selected_index: 1 }).success, false);
});
