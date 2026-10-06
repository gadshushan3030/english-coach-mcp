"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { archiveWordForUser, createWord, recordWordReview, restoreWordForUser, updateWord, WordInputError, type WordMutationResult } from "@/lib/word-management";

function wordError(error: unknown) {
  if ((error as { code?: string })?.code === "23505") return "המילה כבר קיימת ברשימה";
  if (error instanceof WordInputError) return error.message;
  return "השמירה נכשלה. אפשר לנסות שוב";
}

function refreshWords() {
  revalidatePath("/words");
  revalidatePath("/cards");
  revalidatePath("/");
  revalidatePath("/practice");
  revalidatePath("/progress");
}

export async function addManagedWord(_previous: WordMutationResult | null, form: FormData): Promise<WordMutationResult> {
  const userId = await requireUser();
  try {
    const id = await createWord(userId, { english: form.get("english"), hebrew: form.get("hebrew"), example: form.get("example") });
    refreshWords();
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: wordError(error) };
  }
}

export async function editManagedWord(wordId: string, input: unknown): Promise<WordMutationResult> {
  const userId = await requireUser();
  try {
    const id = await updateWord(userId, wordId, input);
    refreshWords();
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: wordError(error) };
  }
}

export async function archiveManagedWord(wordId: string): Promise<WordMutationResult> {
  const userId = await requireUser();
  try {
    const id = await archiveWordForUser(userId, wordId);
    refreshWords();
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: wordError(error) };
  }
}

export async function restoreManagedWord(wordId: string): Promise<WordMutationResult> {
  const userId = await requireUser();
  try {
    const id = await restoreWordForUser(userId, wordId);
    refreshWords();
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: wordError(error) };
  }
}

export async function reviewWordOnce(wordId: string, knew: boolean, requestId: string) {
  const userId = await requireUser();
  try {
    return await recordWordReview(userId, wordId, knew, requestId);
  } catch {
    throw new Error("השמירה נכשלה. אפשר לנסות שוב עם אותו סימון");
  }
}
