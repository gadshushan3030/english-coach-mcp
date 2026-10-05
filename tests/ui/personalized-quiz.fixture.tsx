import { createRoot } from "react-dom/client";
import { PersonalizedQuiz } from "../../app/(main)/talk/PersonalizedQuiz";
import type { PendingQuestion, QuestionResult } from "../../lib/practice-questions";

const questions: PendingQuestion[] = [
  {
    id: "question-one",
    original: "Yesterday I go to work.",
    question: "Which sentence describes yesterday?",
    choices: ["I go to work yesterday.", "I went to work yesterday.", "I will go to work yesterday."],
    source_session_id: "11111111-1111-4111-8111-111111111111",
  },
  {
    id: "question-two",
    original: "She have a meeting.",
    question: "Which sentence is correct?",
    choices: ["She have a meeting.", "She having a meeting.", "She has a meeting."],
    source_session_id: null,
  },
];

type Attempt = { questionId: string; selectedIndex: number };
type Mock = {
  calls: Attempt[];
  answer: (questionId: string, selectedIndex: number) => Promise<QuestionResult>;
  resolve: (canonicalIndex?: number) => void;
  reject: () => void;
  revalidate: () => void;
};

declare global {
  interface Window {
    quizMock: Mock;
  }
}

const storageKey = "quiz-fixture-answers";
const saved = (): Record<string, QuestionResult> => JSON.parse(localStorage.getItem(storageKey) ?? "{}");
let current: { attempt: Attempt; resolve: (value: QuestionResult) => void; reject: (error: Error) => void } | null = null;
const root = createRoot(document.getElementById("root")!);

function render() {
  root.render(
    <PersonalizedQuiz
      initialQuestions={questions.filter((question) => !saved()[question.id])}
      dailyId="test-daily"
      dailyConversation={<p>Mock daily conversation</p>}
    />,
  );
}

window.quizMock = {
  calls: [],
  answer(questionId, selectedIndex) {
    const attempt = { questionId, selectedIndex };
    this.calls.push(attempt);
    return new Promise((resolve, reject) => { current = { attempt, resolve, reject }; });
  },
  resolve(canonicalIndex) {
    if (!current) throw new Error("There is no pending save");
    const question = questions.find((item) => item.id === current!.attempt.questionId)!;
    const correctIndex = question.id === "question-one" ? 1 : 2;
    const selectedIndex = canonicalIndex ?? current.attempt.selectedIndex;
    const answer: QuestionResult = {
      exercise_id: `exercise-${question.id}`,
      selected_index: selectedIndex,
      correct_index: correctIndex,
      result: selectedIndex === correctIndex ? "correct" : "incorrect",
      answer: question.choices[selectedIndex],
      expected: question.choices[correctIndex],
      explanation_he: "זהו ההסבר בעברית שמגיע רק אחרי שמירת התשובה.",
    };
    localStorage.setItem(storageKey, JSON.stringify({ ...saved(), [question.id]: answer }));
    current.resolve(answer);
    current = null;
  },
  reject() {
    if (!current) throw new Error("There is no pending save");
    current.reject(new Error("Simulated connection failure"));
    current = null;
  },
  revalidate: render,
};

render();
