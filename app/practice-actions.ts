"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { answerReview } from "@/lib/learning-store";
import type { ReviewAnswerInput } from "@/lib/learning-loop";

export async function saveReview(input: ReviewAnswerInput) {
  const userId = await requireUser();
  try {
    const result = await answerReview(userId, input);
    revalidatePath("/progress");
    revalidatePath("/");
    return result;
  } catch {
    throw new Error("לא התקבל אישור שמירה. אפשר לנסות שוב, או לרענן אם התרגיל נענה בחלון אחר.");
  }
}
