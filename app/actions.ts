"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DIALOGUES, STARTER_WORDS } from "@/lib/content";
import { createClient, isAllowedEmail } from "@/lib/supabase";

const LOGIN_ERROR = "האימייל או הסיסמה שגויים";

export async function login(_prev: string | null, form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "");
  if (!isAllowedEmail(email)) return LOGIN_ERROR;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return LOGIN_ERROR;
  // Same-site paths only, never "//evil.com".
  redirect(/^\/(?![/\\])/.test(next) ? next : "/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function reviewWord(wordId: string, knew: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_word", { p_word_id: wordId, p_knew: knew === true });
  if (error) throw new Error("השמירה נכשלה");
}

export async function addWord(_prev: string | null, form: FormData) {
  const english = String(form.get("english") ?? "").trim();
  const hebrew = String(form.get("hebrew") ?? "").trim();
  const example = String(form.get("example") ?? "").trim() || null;
  if (!english || !hebrew) return "צריך למלא מילה ותרגום";

  const supabase = await createClient();
  const { error } = await supabase.from("words").insert({ english, hebrew, example });
  if (error) return error.code === "23505" ? "המילה כבר קיימת" : "השמירה נכשלה";
  revalidatePath("/words");
  return null;
}

export async function deleteWord(wordId: string) {
  const supabase = await createClient();
  await supabase.from("words").delete().eq("id", wordId);
  revalidatePath("/words");
}

export async function addStarterWords() {
  const supabase = await createClient();
  await supabase.from("words").upsert(STARTER_WORDS, { onConflict: "user_id,english", ignoreDuplicates: true });
  revalidatePath("/", "layout");
}

// The in-app daily dialogue is a checked practice session like any other (source "app").
export async function saveConversation(requestId: string, dialogueId: string, picks: number[]) {
  const dialogue = DIALOGUES.find((d) => d.id === dialogueId);
  if (!dialogue || picks.length !== dialogue.turns.length || !/^[\w-]{8,64}$/.test(requestId)) throw new Error("נתונים לא תקינים");

  const supabase = await createClient();
  const { data: sessionId, error } = await supabase.rpc("start_practice", {
    p_request_id: `app:${requestId}`,
    p_topic: dialogue.title,
    p_level: "A1",
    p_source: "app",
  });
  if (error) throw new Error("השמירה נכשלה");

  const { error: finishError } = await supabase.rpc("finish_practice", {
    p_session_id: sessionId,
    p_sentences: dialogue.turns.map((t) => ({ en: t.options[t.answer], he: t.answerHe })),
    p_exercises: dialogue.turns.map((t, i) => ({
      request_id: `app:${requestId}:${i}`,
      question: t.they,
      answer: t.options[picks[i]] ?? "",
      expected: t.options[t.answer],
      result: picks[i] === t.answer ? "correct" : "incorrect",
    })),
    p_checked_by: "app",
  });
  if (finishError) throw new Error("השמירה נכשלה");
}

// OAuth consent for an external assistant (Supabase OAuth 2.1 server).
export async function decideConnection(authorizationId: string, approve: boolean) {
  const supabase = await createClient();
  const { data, error } = approve
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (error || !data) throw new Error("בקשת החיבור נכשלה");
  redirect(data.redirect_url);
}

export async function revokeConnection(clientId: string) {
  const supabase = await createClient();
  await supabase.auth.oauth.revokeGrant({ clientId });
  revalidatePath("/progress");
}
