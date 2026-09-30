"use client";

import { useActionState } from "react";
import { addWord } from "@/app/actions";

export function AddWordForm() {
  const [error, action, pending] = useActionState(addWord, null);

  return (
    <form action={action} className="surface grid gap-3 p-4 sm:grid-cols-2">
      <input name="english" placeholder="English" dir="ltr" lang="en" required maxLength={100} autoCapitalize="none" className="input" />
      <input name="hebrew" placeholder="תרגום" required maxLength={100} className="input" />
      <input name="example" placeholder="Example sentence (optional)" dir="ltr" lang="en" maxLength={300} className="input sm:col-span-2" />
      {error && <p role="alert" className="text-sm text-[var(--bad)] sm:col-span-2">{error}</p>}
      <button className="btn sm:col-span-2" disabled={pending}>הוספה</button>
    </form>
  );
}
