"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="surface flex flex-col gap-4 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const form = new FormData(e.currentTarget);
        const { data, error } = await authClient.signIn.email({
          email: String(form.get("email")),
          password: String(form.get("password")),
        });
        if (error) {
          setPending(false);
          return setError("האימייל או הסיסמה שגויים");
        }
        // During an assistant OAuth flow the server answers with the next step (consent page).
        window.location.href = (data as { url?: string }).url ?? "/";
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">אימייל</span>
        <input name="email" type="email" dir="ltr" autoComplete="username" required className="input" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">סיסמה</span>
        <input name="password" type="password" dir="ltr" autoComplete="current-password" required className="input" />
      </label>
      {error && <p role="alert" className="text-sm text-[var(--bad)]">{error}</p>}
      <button className="btn" disabled={pending}>{pending ? "רגע…" : "כניסה"}</button>
    </form>
  );
}
