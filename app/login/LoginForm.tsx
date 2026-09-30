"use client";

import { useActionState } from "react";
import { login } from "@/app/actions";

export function LoginForm({ next }: { next: string }) {
  const [error, action, pending] = useActionState(login, null);

  return (
    <form action={action} className="surface flex flex-col gap-4 p-5">
      <input type="hidden" name="next" value={next} />
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
