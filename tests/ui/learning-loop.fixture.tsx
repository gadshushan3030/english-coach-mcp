import { createRoot } from "react-dom/client";
import { ReviewPractice } from "../../app/(main)/practice/ReviewPractice";
import type { ReviewAnswerInput, ReviewPrompt, ReviewResult } from "../../lib/learning-loop";

const source = "11111111-1111-4111-8111-111111111111";
const reviews: ReviewPrompt[] = [
  { id: "00000000-0000-4000-8000-000000000001", source_question_id: source, source_session_id: source,
    revision: 0, stage: "recognition", question: "Which sentence describes yesterday?", prompt: "Which sentence describes yesterday?",
    choices: ["I go to work yesterday.", "I went to work yesterday.", "I going to work yesterday."], due_at: "2026-10-06T00:00:00Z", is_variant: false },
  { id: "00000000-0000-4000-8000-000000000002", source_question_id: source, source_session_id: source,
    revision: 2, stage: "completion", question: "Which sentence is correct?", prompt: "I _____ to work yesterday.",
    choices: null, due_at: "2026-10-06T00:00:00Z", is_variant: false },
  { id: "00000000-0000-4000-8000-000000000003", source_question_id: source, source_session_id: source,
    revision: 4, stage: "rewrite", question: "Which sentence is correct?", prompt: "I go to work yesterday.",
    choices: null, due_at: "2026-10-06T00:00:00Z", is_variant: false },
];

type Mock = {
  calls: ReviewAnswerInput[];
  completions: number;
  answer: (input: ReviewAnswerInput) => Promise<ReviewResult>;
  resolve: (canonicalAnswer?: string | number) => void;
  reject: () => void;
  revalidate: () => void;
};
declare global { interface Window { learningMock: Mock } }
const storageKey = "learning-fixture-results";
const saved = (): Record<string, ReviewResult> => JSON.parse(localStorage.getItem(storageKey) ?? "{}");
let current: { input: ReviewAnswerInput; resolve: (value: ReviewResult) => void; reject: (error: Error) => void } | null = null;
const root = createRoot(document.getElementById("root")!);
const params = new URLSearchParams(window.location.search);
const start = Math.max(0, reviews.findIndex((item) => item.stage === params.get("stage")));

function render() {
  root.render(<>
    <ReviewPractice reviews={reviews.slice(start).filter((item) => !saved()[item.id]).map((item) => ({ ...item, is_variant: params.get("variant") === "1" }))}
      embedded onComplete={() => { window.learningMock.completions++; render(); }} />
    {window.learningMock.completions > 0 && <p>Mock next daily stage</p>}
  </>);
}
window.learningMock = {
  calls: [], completions: 0,
  answer(input) {
    this.calls.push({ ...input });
    return new Promise((resolve, reject) => { current = { input, resolve, reject }; });
  },
  resolve(canonicalAnswer) {
    if (!current) throw new Error("No pending review save");
    const item = reviews.find((review) => review.id === current!.input.review_id)!;
    const expected = item.stage === "completion" ? "went" : "I went to work yesterday.";
    const selected = item.stage === "recognition" ? (typeof canonicalAnswer === "number" ? canonicalAnswer : current.input.selected_index!) : null;
    const answer = selected !== null ? item.choices![selected] : typeof canonicalAnswer === "string" ? canonicalAnswer : current.input.answer!;
    const result: ReviewResult = {
      exercise_id: `exercise-${item.id}`, review_id: item.id, revision: item.revision, stage: item.stage,
      result: answer.toLowerCase().replace(/[.!?]$/, "") === expected.toLowerCase().replace(/[.!?]$/, "") ? "correct" : "incorrect",
      answer, expected, corrected_sentence: "I went to work yesterday.", explanation_he: "ההסבר שנשמר אחרי התשובה בלבד.",
      selected_index: selected, next_due_at: "2026-10-09T09:00:00Z", next_stage: item.stage === "recognition" ? "completion" : "rewrite", source_session_id: source,
    };
    localStorage.setItem(storageKey, JSON.stringify({ ...saved(), [item.id]: result }));
    current.resolve(result); current = null;
  },
  reject() {
    if (!current) throw new Error("No pending review save");
    current.reject(new Error("Simulated connection failure")); current = null;
  },
  revalidate: render,
};
render();
