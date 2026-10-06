import { sql } from "./db";
import { DEFAULT_PROFILE, type LearnerProfile } from "./learner-profile";

export async function readLearnerProfile(userId: string) {
  const [profile] = await sql<LearnerProfile>(
    "select goal, level, daily_minutes, level_basis, diagnostic_correct, diagnostic_total from learner_profiles where user_id = $1", [userId],
  );
  return { profile: profile ?? DEFAULT_PROFILE, configured: Boolean(profile) };
}
