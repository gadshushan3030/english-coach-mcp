"use client";

import { useRef, useState, useTransition } from "react";
import { archiveManagedWord, editManagedWord, restoreManagedWord } from "@/app/word-actions";
import { Icon } from "@/components/Icon";

export type ManagedWord = {
  id: string; english: string; hebrew: string; example: string | null;
  status: "new" | "practice" | "known"; correct: number; attempts: number;
};

const STATUS = {
  new: { label: "חדשה", color: "var(--muted)" },
  practice: { label: "לתרגול", color: "var(--warn)" },
  known: { label: "סומנה כידועה", color: "var(--good)" },
} as const;

function WordRow({ word, onArchived }: { word: ManagedWord; onArchived: (word: ManagedWord) => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [english, setEnglish] = useState(word.english);
  const [hebrew, setHebrew] = useState(word.hebrew);
  const [example, setExample] = useState(word.example ?? "");
  const [pending, startTransition] = useTransition();
  const saving = useRef(false);
  const status = STATUS[word.status];

  function archive() {
    if (saving.current) return;
    saving.current = true;
    startTransition(async () => {
      try {
        const result = await archiveManagedWord(word.id);
        if (!result.ok) { setError(result.error); return; }
        setError(null);
        onArchived(word);
      } catch { setError("המחיקה נכשלה. אפשר לנסות שוב"); }
      finally { saving.current = false; }
    });
  }

  return (
    <li className="grid gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-40">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span dir="ltr" lang="en" className="min-w-0 break-words font-semibold">{word.english}</span>
            <span className="min-w-0 break-words">{word.hebrew}</span>
          </div>
          {word.example && <p dir="ltr" lang="en" className="muted break-words text-start text-sm">{word.example}</p>}
        </div>
        <div className="flex flex-col items-end text-xs">
          <span className="font-medium" style={{ color: status.color }} title="סימון עצמי בכרטיסיות">{status.label}</span>
          {word.attempts > 0 && <span className="muted" title="תשובות שנבדקו בפועל">נבדק: {word.correct}/{word.attempts}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button className="min-h-11 rounded-xl px-3 text-sm hover:bg-ground disabled:opacity-50" disabled={pending} aria-label={`עריכת ${word.english}`} aria-expanded={editing} onClick={() => {
            if (!editing) { setEnglish(word.english); setHebrew(word.hebrew); setExample(word.example ?? ""); }
            setError(null); setEditing(!editing);
          }}>עריכה</button>
          <button aria-label={`מחיקת ${word.english}`} className="muted flex size-11 items-center justify-center rounded-full hover:bg-ground disabled:opacity-50" disabled={pending} onClick={archive}>
            <Icon name="x" size={18} />
          </button>
        </div>
      </div>
      {editing && (
        <form className="grid gap-3 rounded-xl bg-ground p-3 sm:grid-cols-2" onSubmit={(event) => {
          event.preventDefault();
          if (saving.current) return;
          saving.current = true;
          startTransition(async () => {
            try {
              const result = await editManagedWord(word.id, { english, hebrew, example });
              if (!result.ok) { setError(result.error); return; }
              setError(null); setEditing(false);
            } catch { setError("השמירה נכשלה. הפרטים נשמרו כאן ואפשר לנסות שוב"); }
            finally { saving.current = false; }
          });
        }}>
          <label className="grid gap-1 text-sm">מילה באנגלית
            <input className="input" dir="ltr" lang="en" value={english} onChange={(event) => setEnglish(event.target.value)} autoCapitalize="none" autoFocus required maxLength={100} disabled={pending} />
          </label>
          <label className="grid gap-1 text-sm">תרגום לעברית
            <input className="input" value={hebrew} onChange={(event) => setHebrew(event.target.value)} required maxLength={100} disabled={pending} />
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">משפט לדוגמה (אפשר להשאיר ריק)
            <textarea className="input min-h-24 py-2" dir="ltr" lang="en" value={example} onChange={(event) => setExample(event.target.value)} maxLength={300} disabled={pending} />
          </label>
          <button className="btn" disabled={pending}>{pending ? "שומר…" : error ? "ניסיון שמירה נוסף" : "שמירת השינויים"}</button>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { setEditing(false); setError(null); }}>ביטול</button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
    </li>
  );
}

export function WordList({ words }: { words: ManagedWord[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [removed, setRemoved] = useState<ManagedWord[]>([]);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const restoring = useRef(false);
  const needle = search.trim().toLocaleLowerCase();
  const removedWords = removed.filter((word) => !words.some((active) => active.id === word.id));
  const visible = words.filter((word) => (status === "all" || word.status === status) &&
    [word.english, word.hebrew, word.example ?? ""].some((text) => text.toLocaleLowerCase().includes(needle)));

  function restore(word: ManagedWord) {
    if (restoring.current) return;
    restoring.current = true;
    startTransition(async () => {
      try {
        const result = await restoreManagedWord(word.id);
        if (!result.ok) { setRestoreError(result.error); return; }
        setRestoreError(null);
        setRemoved((items) => items.filter((item) => item.id !== word.id));
      } catch { setRestoreError("השחזור נכשל. אפשר לנסות שוב"); }
      finally { restoring.current = false; }
    });
  }

  return (
    <section className="grid gap-3" aria-label="רשימת המילים">
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <label className="grid gap-1 text-sm">חיפוש מילה או דוגמה
          <input type="search" className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="אנגלית או עברית" />
        </label>
        <label className="grid gap-1 text-sm">סינון לפי סימון עצמי
          <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">כל המילים</option>
            <option value="new">חדשות</option>
            <option value="practice">לתרגול</option>
            <option value="known">סומנו כידועות</option>
          </select>
        </label>
      </div>
      {removedWords.length > 0 && <div className="surface grid gap-2 p-3" aria-live="polite">
        {removedWords.map((word) => <div key={word.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p><bdi lang="en">{word.english}</bdi> הוסרה מהתרגול</p>
          <button className="min-h-11 rounded-xl bg-accent-soft px-3 font-semibold text-accent disabled:opacity-50" disabled={pending} onClick={() => restore(word)}>ביטול המחיקה</button>
        </div>)}
        {restoreError && <p role="alert" className="text-sm text-warn">{restoreError}</p>}
      </div>}
      <p role="status" className="muted text-sm">{visible.length} מתוך {words.length} מילים</p>
      <ul className="surface divide-y divide-line overflow-hidden">
        {visible.map((word) => <WordRow key={word.id} word={word} onArchived={(removedWord) => setRemoved((items) => [...items.filter((item) => item.id !== removedWord.id), removedWord])} />)}
        {!visible.length && <li className="muted p-6 text-center">{words.length ? "אין מילים שמתאימות לחיפוש ולסינון" : "אין עדיין מילים. אפשר להוסיף מילה ראשונה למעלה"}</li>}
      </ul>
    </section>
  );
}
