"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DIALOGUES, STARTER_WORDS } from "@/lib/content";
import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";

export async function logout() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}

export async function reviewWord(wordId: string, knew: boolean) {
  const userId = await requireUser();
  await sql("select review_word($1, $2, $3)", [userId, wordId, knew === true]).catch(() => {
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
  await sql("delete from words where id = $1 and user_id = $2", [wordId, userId]);
  revalidatePath("/words");
}

export async function addStarterWords() {
  const userId = await requireUser();
  await sql(
    `insert into words (user_id, english, hebrew, example)
     select $1, w.english, w.hebrew, w.example from jsonb_to_recordset($2) as w(english text, hebrew text, example text)
     on conflict (user_id, english) do nothing`,
    [userId, JSON.stringify(STARTER_WORDS)],
  );
  revalidatePath("/", "layout");
}

// The in-app daily dialogue is a checked practice session like any other (source "app").
export async function saveConversation(requestId: string, dialogueId: string, picks: number[]) {
  const userId = await requireUser();
  const dialogue = DIALOGUES.find((d) => d.id === dialogueId);
  if (!dialogue || picks.length !== dialogue.turns.length || !/^[\w-]{8,64}$/.test(requestId)) throw new Error("נתונים לא תקינים");

  try {
    const [{ id }] = await sql<{ id: string }>("select start_practice($1, $2, $3, 'A1', 'text', 'app') as id", [
      userId,
      `app:${requestId}`,
      dialogue.title,
    ]);
    await sql("select finish_practice(p_user_id => $1, p_session_id => $2, p_sentences => $3, p_exercises => $4, p_checked_by => 'app')", [
      userId,
      id,
      JSON.stringify(dialogue.turns.map((t) => ({ en: t.options[t.answer], he: t.answerHe }))),
      JSON.stringify(
        dialogue.turns.map((t, i) => ({
          request_id: `app:${requestId}:${i}`,
          question: t.they,
          answer: t.options[picks[i]] ?? "",
          expected: t.options[t.answer],
          result: picks[i] === t.answer ? "correct" : "incorrect",
        })),
      ),
    ]);
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
