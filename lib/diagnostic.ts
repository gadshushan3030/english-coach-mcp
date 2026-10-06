import type { LearningLevel } from "./learner-profile";

// A short placement hint, not a validated CEFR examination. Answer keys stay on the server.
export const DIAGNOSTIC = [
  { question: "How are you?", choices: ["I'm fine, thanks.", "I from Israel.", "At seven."], correct: 0 },
  { question: "Choose the correct sentence.", choices: ["She work here.", "She works here.", "She working here."], correct: 1 },
  { question: "What did you do yesterday?", choices: ["I go shopping yesterday.", "I going shopping yesterday.", "I went shopping yesterday."], correct: 2 },
  { question: "Choose the correct sentence.", choices: ["I've lived here for three years.", "I live here since three years.", "I'm live here for three years."], correct: 0 },
  { question: "If I had more time, …", choices: ["I will travel more.", "I would travel more.", "I travel yesterday."], correct: 1 },
  { question: "Which reply politely asks for clarification?", choices: ["You are wrong.", "Say it yesterday.", "Could you explain what you mean?"], correct: 2 },
] as const;

export function gradeDiagnostic(answers: number[]) {
  if (answers.length !== DIAGNOSTIC.length || answers.some((answer) => !Number.isInteger(answer) || answer < 0 || answer > 2)) {
    throw new Error("יש להשלים את כל שאלות האבחון");
  }
  const correct = answers.filter((answer, index) => answer === DIAGNOSTIC[index].correct).length;
  const level: LearningLevel = correct === 0 ? "A0" : correct <= 2 ? "A1" : correct <= 4 ? "A2" : "B1";
  const exercises = DIAGNOSTIC.map((question, index) => ({
    question: question.question, answer: question.choices[answers[index]],
    expected: question.choices[question.correct], result: answers[index] === question.correct ? "correct" : "incorrect",
  }));
  return { level, correct, total: DIAGNOSTIC.length, exercises };
}
