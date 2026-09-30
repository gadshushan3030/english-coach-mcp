import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Already signed in and not in the middle of an OAuth authorization → home.
  const oauthFlow = "client_id" in (await searchParams);
  if (!oauthFlow && (await auth.api.getSession({ headers: await headers() }))) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5">
      <h1 className="text-center text-3xl font-bold">English Coach</h1>
      {oauthFlow && <p className="muted text-center text-sm">כניסה כדי לחבר את העוזר לחשבון</p>}
      <LoginForm />
    </main>
  );
}
