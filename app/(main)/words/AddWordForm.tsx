"use client";

import { useRef, useState, useTransition } from "react";
import { addManagedWord } from "@/app/word-actions";

export function AddWordForm() {
  const [english, setEnglish] = useState("");
  const [hebrew, setHebrew] = useState("");
  const [example, setExample] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const saving = useRef(false);

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      if (saving.current) return;
      saving.current = true;
      const form = new FormData(event.currentTarget);
      setSaved(false);
      startTransition(async () => {
        try {
          const result = await addManagedWord(null, form);
          if (!result.ok) { setError(result.error); return; }
          setError(null);
          setEnglish(""); setHebrew(""); setExample("");
          setSaved(true);
        } catch { setError("השמירה נכשלה. הפרטים נשמרו כאן ואפשר לנסות שוב"); }
        finally { saving.current = false; }
      });
    }} className="surface grid gap-3 p-4 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">מילה באנגלית
        <input name="english" placeholder="English" value={english} onChange={(event) => setEnglish(event.target.value)} dir="ltr" lang="en" required maxLength={100} autoCapitalize="none" disabled={pending} className="input" />
      </label>
      <label className="grid gap-1 text-sm">תרגום לעברית
        <input name="hebrew" placeholder="תרגום" value={hebrew} onChange={(event) => setHebrew(event.target.value)} required maxLength={100} disabled={pending} className="input" />
      </label>
      <label className="grid gap-1 text-sm sm:col-span-2">משפט לדוגמה (אפשר להשאיר ריק)
        <input name="example" placeholder="Example sentence" value={example} onChange={(event) => setExample(event.target.value)} dir="ltr" lang="en" maxLength={300} disabled={pending} className="input" />
      </label>
      {error && <p role="alert" className="text-sm text-warn sm:col-span-2">{error}</p>}
      {saved && <p role="status" className="text-sm text-accent sm:col-span-2">המילה נשמרה ברשימה</p>}
      <button className="btn sm:col-span-2" disabled={pending}>{pending ? "שומר…" : error ? "ניסיון שמירה נוסף" : "הוספה"}</button>
    </form>
  );
}
