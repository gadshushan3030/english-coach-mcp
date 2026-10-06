"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { STARTER_WORDS } from "@/lib/content";
import { persistConversation } from "@/lib/conversation-store";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { answerQuestion } from "@/lib/question-store";

export async function logout() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}

export async function reviewWord(wordId: string, knew: boolean, requestId: string) {
  const userId = await requireUser();
  if (!/^[\w-]{8,100}$/.test(requestId)) throw new Error("נתונים לא תקינים");
  await sql("select review_word_once($1, $2, $3, $4)", [userId, wordId, knew === true, requestId]).catch(() => {
    throw new Error("השמירה נכשלה");
  });
}

export async function addWord(_prev: string | null, form: FormData) {
  const userId = await requireUser();
  const english = String(form.get("english") ?? "").trim();
  const hebrew = String(form.get("hebrew") ?? "").trim();
  const example = String(form.get("example") ?? "").trim() || null;
  if (!english || !hebrew) return "צריך למלא מילה ותרגום";

  try {
    await sql("insert into words (user_id, english, hebrew, example) values ($1, $2, $3, $4)", [userId, english, hebrew, example]);
  } catch (error) {
    return (error as { code?: string }).code === "23505" ? "המילה כבר קיימת" : "השמירה נכשלה";
  }
  revalidatePath("/words");
  return null;
}

export async function deleteWord(wordId: string) {
  const userId = await requireUser();
  await sql("update words set archived_at=now() where id = $1 and user_id = $2 and archived_at is null", [wordId, userId]);
  revalidatePath("/words");
}

export async function addStarterWords() {
  const userId = await requireUser();
  await sql(
    `insert into words (user_id, english, hebrew, example)
     select $1, w.english, w.hebrew, w.example from jsonb_to_recordset($2) as w(english text, hebrew text, example text)
     on conflict (user_id, english) do update set archived_at=null where words.archived_at is not null`,
    [userId, JSON.stringify(STARTER_WORDS)],
  );
  revalidatePath("/", "layout");
}

// The in-app daily dialogue is a checked practice session like any other (source "app").
export async function saveConversation(requestId: string, dialogueId: string, picks: number[], expectedUserId: string) {
  const userId = await requireUser();
  if (expectedUserId !== userId) throw new Error("החשבון השתנה. יש לרענן את התרגול לפני שמירה");

  try {
    const result = await persistConversation(userId, expectedUserId, requestId, dialogueId, picks);
    revalidatePath("/progress");
    revalidatePath("/");
    return result;
  } catch {
    throw new Error("השמירה נכשלה");
  }
}

// Disconnects an assistant for this user only. OAuth clients are shared (dynamic registration),
// so the client stays; the user's consent and refresh tokens go (access tokens cascade), and
// /mcp rejects any remaining access token because the consent is gone.
export async function revokeConnection(clientId: string) {
  const userId = await requireUser();
  await sql(`delete from "oauthConsent" where "clientId" = $1 and "userId" = $2`, [clientId, userId]);
  await sql(`delete from "oauthRefreshToken" where "clientId" = $1 and "userId" = $2`, [clientId, userId]);
  await sql(`delete from "oauthAccessToken" where "clientId" = $1 and "userId" = $2`, [clientId, userId]);
  revalidatePath("/progress");
}

// Only the identity and selected index cross the client boundary; grading is canonical in SQL.
export async function answerPracticeQuestion(questionId: string, selectedIndex: number) {
  const userId = await requireUser();
  try {
    const result = await answerQuestion(userId, questionId, selectedIndex);
    revalidatePath("/progress");
    return result;
  } catch {
    throw new Error("השמירה נכשלה. אפשר לנסות שוב עם אותה בחירה");
  }
}
