"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveConversation } from "@/app/actions";
import { Speak } from "@/components/Speak";
import type { Dialogue } from "@/lib/content";

// `shift` rotates the answer order per day, so the right answer isn't always in the same spot.
export function Conversation({ dialogue, nextId, shift }: { dialogue: Dialogue; nextId: string; shift: number }) {
  const [t, setT] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  // One id per run: a retried save is recognized and not stored twice.
  const [requestId] = useState(() => crypto.randomUUID());
  const score = picks.filter((p, i) => p === dialogue.turns[i].answer).length;
  const [saved, setSaved] = useState<"no" | "yes" | "error">("no");
  const [pending, startTransition] = useTransition();

  const finished = t >= dialogue.turns.length;
  const history = dialogue.turns.slice(0, t);

  const advance = () => {
    const nextT = t + 1;
    setPicked(null);
    setT(nextT);
    if (nextT >= dialogue.turns.length) {
      startTransition(async () => {
        try {
          await saveConversation(requestId, dialogue.id, picks);
          setSaved("yes");
        } catch {
          setSaved("error");
        }
      });
    }
  };

  return (
    <section className="flex flex-col gap-3">
      {history.map((turn, k) => (
        <div key={k} className="flex flex-col gap-2">
          <Bubble side="they" text={turn.they} />
          <Bubble side="you" text={turn.options[turn.answer]} />
        </div>
      ))}

      {!finished && (
        <Current
          turn={dialogue.turns[t]}
          shift={shift + t}
          picked={picked}
          onPick={(i) => {
            setPicked(i);
            setPicks([...picks, i]);
          }}
          onNext={advance}
        />
      )}

      {finished && (
        <div className="surface flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-2xl font-bold">
            {score}/{dialogue.turns.length} 🎉
          </p>
          <p className="muted text-sm">
            {pending ? "בשמירה…" : saved === "error" ? "השמירה נכשלה" : saved === "yes" ? "נשמר" : ""}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={`/talk?d=${nextId}`} className="btn">שיחה נוספת</Link>
            <Link href="/" className="btn btn-ghost">לדף הבית</Link>
          </div>
        </div>
      )}
    </section>
  );
}

function Current({
  turn,
  shift,
  picked,
  onPick,
  onNext,
}: {
  turn: Dialogue["turns"][number];
  shift: number;
  picked: number | null;
  onPick: (i: number) => void;
  onNext: () => void;
}) {
  const n = turn.options.length;
  const order = turn.options.map((_, i) => (i + shift) % n);

  return (
    <div className="flex flex-col gap-3">
      <Bubble side="they" text={turn.they} speak />
      <details className="muted text-sm">
        <summary className="cursor-pointer py-1">תרגום</summary>
        {turn.theyHe}
      </details>
      <div className="flex flex-col gap-2">
        {order.map((i) => {
          const state = picked === null ? "" : i === turn.answer ? "border-[var(--good)] bg-[var(--good)]/10" : i === picked ? "border-[var(--bad)] bg-[var(--bad)]/10" : "opacity-50";
          return (
            <button
              key={i}
              type="button"
              dir="ltr"
              lang="en"
              disabled={picked !== null}
              onClick={() => onPick(i)}
              className={`surface min-h-12 px-4 py-3 text-start text-lg ${state}`}
            >
              {turn.options[i]}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {picked === turn.answer ? "נכון! " : "התשובה הטבעית: "}
            <span className="muted">{turn.answerHe}</span>
          </p>
          <button className="btn" onClick={onNext}>המשך</button>
        </div>
      )}
    </div>
  );
}

function Bubble({ side, text, speak }: { side: "they" | "you"; text: string; speak?: boolean }) {
  // In RTL, "they" sits on the right (start) and "you" on the left (end), like a chat.
  return (
    <div className={`flex items-center gap-1 ${side === "you" ? "justify-end" : ""}`}>
      <p
        dir="ltr"
        lang="en"
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-lg ${side === "they" ? "surface" : "bg-[var(--accent)] text-[var(--on-accent)]"}`}
      >
        {text}
      </p>
      {speak && <Speak text={text} />}
    </div>
  );
}
