"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function ConsentButtons() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  const decide = async (accept: boolean) => {
    setPending(true);
    const { data, error } = await authClient.oauth2.consent({ accept });
    const to = (data as { redirect_uri?: string } | null)?.redirect_uri;
    if (error || !to) {
      setPending(false);
      return setError(true);
    }
    window.location.href = to;
  };

  return (
    <div className="flex flex-col gap-2">
      {error && <p role="alert" className="text-sm text-[var(--bad)]">הבקשה נכשלה או שפג תוקפה. אפשר להתחיל את החיבור מחדש מהעוזר.</p>}
      <div className="grid grid-cols-2 gap-3">
        <button className="btn btn-ghost" disabled={pending} onClick={() => decide(false)}>דחייה</button>
        <button className="btn" disabled={pending} onClick={() => decide(true)}>אישור</button>
      </div>
    </div>
  );
}
