import * as z from "zod/v4";

export const GOALS = { everyday: "שיחה יומיומית", work: "אנגלית לעבודה", travel: "אנגלית לנסיעות" } as const;
export const LEVELS = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type LearningGoal = keyof typeof GOALS;
export type LearningLevel = typeof LEVELS[number];
export type LearnerProfile = {
  goal: LearningGoal;
  level: LearningLevel;
  daily_minutes: number;
  level_basis: "diagnostic" | "self_selected";
  diagnostic_correct: number | null;
  diagnostic_total: number | null;
};
export const profileInput = z.object({
  request_id: z.string().min(8).max(88),
  goal: z.enum(["everyday", "work", "travel"]),
  daily_minutes: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  level: z.enum(LEVELS).optional(),
  answers: z.array(z.number().int().min(0).max(2)).length(6).optional(),
}).refine((value) => Boolean(value.level) !== Boolean(value.answers), "בחרו רמה או השלימו את האבחון");

export const DEFAULT_PROFILE: LearnerProfile = {
  goal: "everyday", level: "A1", daily_minutes: 5, level_basis: "self_selected",
  diagnostic_correct: null, diagnostic_total: null,
};

export function dailyBudget(minutes: number) {
  return minutes >= 15 ? { words: 12, questions: 5, reviews: 5 }
    : minutes >= 10 ? { words: 8, questions: 4, reviews: 4 }
      : { words: 4, questions: 2, reviews: 2 };
}
