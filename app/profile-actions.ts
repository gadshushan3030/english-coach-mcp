"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { sql } from "@/lib/db";
import { profileInput, type LearnerProfile } from "@/lib/learner-profile";
import { gradeDiagnostic } from "@/lib/diagnostic";

export async function saveLearnerProfile(input: unknown): Promise<LearnerProfile> {
  const userId = await requireUser();
  const parsed = profileInput.safeParse(input);
  if (!parsed.success) throw new Error("יש לבחור מטרה ורמה, או להשלים את כל שאלות האבחון");
  const value = parsed.data;
  const diagnostic = value.answers ? gradeDiagnostic(value.answers) : null;
  const [{ profile }] = await sql<{ profile: LearnerProfile }>(
    "select save_learner_profile($1,$2,$3,$4,$5,$6::jsonb) as profile",
    [userId,value.request_id,value.goal,diagnostic?.level ?? value.level,value.daily_minutes,
      diagnostic ? JSON.stringify(diagnostic.exercises) : null],
  );
  revalidatePath("/", "layout");
  return profile;
}
