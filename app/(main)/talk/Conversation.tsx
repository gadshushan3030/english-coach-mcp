"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveConversation } from "@/app/actions";
import { Icon } from "@/components/Icon";
import { Speak } from "@/components/Speak";
import { TopBar } from "@/components/TopBar";
import type { Dialogue } from "@/lib/content";

// `shift` rotates the answer order per day, so the right answer isn't always in the same spot.
export function Conversation({
  dialogue,
  nextId,
  shift,
  doneToday,
}: {
  dialogue: Dialogue;
  nextId: string;
  shift: number;
  doneToday: { correct: number; total: number } | null;
}) {
  const [t, setT] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  // One id per run: a retried save is recognized and not stored twice.
  const [requestId] = useState(() => crypto.randomUUID());
  const score = picks.filter((p, i) => p === dialogue.turns[i].answer).length;
  const [saved, setSaved] = useState<"no" | "yes" | "error">("no");
  const [pending, startTransition] = useTransition();

  const n = dialogue.turns.length;
  const finished = t >= n;
  const history = dialogue.turns.slice(0, t);

  const advance = () => {
    const nextT = t + 1;
    setPicked(null);
    setT(nextT);
    if (nextT >= n) {
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
    <section data-focus className="flex flex-col gap-3.5">
      <TopBar title="שיחה יומית" end={`${Math.min(t + 1, n)}/${n}`} />
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[22px] font-bold">{dialogue.title}</h1>
        <p className={`text-[13px] ${doneToday ? "text-accent" : "muted"}`}>
          {doneToday ? `תורגלה היום · ${doneToday.correct}/${doneToday.total}` : `${n} משפטים · 2 דקות`}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {history.map((turn, k) => (
          <div key={k} className="flex flex-col items-start gap-2">
            <Bubble side="they" text={turn.they} />
            <div className="flex flex-col items-end gap-1 self-stretch">
              <Bubble side="you" text={turn.options[turn.answer]} />
              {picks[k] === turn.answer ? (
                <span className="flex items-center gap-1 text-xs text-accent">
                  <Icon name="check" size={13} strokeWidth={2.4} />
                  נכון
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-warn">
                  <Icon name="x" size={13} strokeWidth={2.4} />
                  בחרת: <span dir="ltr" lang="en">{turn.options[picks[k]]}</span>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {!finished && (
        <Current
          key={t}
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
          <p className="text-3xl font-bold tabular-nums">
            {score}/{n}
          </p>
          <p className="muted text-sm">
            {pending ? "בשמירה…" : saved === "error" ? "השמירה נכשלה" : saved === "yes" ? "נשמר בהתקדמות" : ""}
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
  const [showHe, setShowHe] = useState(false);
  const n = turn.options.length;
  const order = turn.options.map((_, i) => (i + shift) % n);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Bubble side="they" text={turn.they} />
          <Speak text={turn.they} />
          <button
            type="button"
            aria-pressed={showHe}
            onClick={() => setShowHe(!showHe)}
            className="muted h-11 shrink-0 rounded-full border border-line px-3 text-[13px] aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent"
          >
            תרגום
          </button>
        </div>
        {showHe && <p className="muted text-sm">{turn.theyHe}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <span className="muted text-[13px]">מה עונים?</span>
        {order.map((i) => {
          const right = i === turn.answer;
          const mine = i === picked;
          const state =
            picked === null
              ? "border border-line bg-surface"
              : right
                ? "border-2 border-accent bg-accent-soft"
                : mine
                  ? "border-2 border-warn bg-warn-soft"
                  : "border border-line bg-surface text-muted";
          return (
            <button
              key={i}
              type="button"
              dir="ltr"
              lang="en"
              disabled={picked !== null}
              onClick={() => onPick(i)}
              className={`flex min-h-13 items-center gap-2.5 rounded-[14px] px-4 text-start text-base ${state}`}
            >
              <span className="flex-1">{turn.options[i]}</span>
              {picked !== null && right && <Icon name="check" size={18} strokeWidth={2.4} className="text-accent" />}
              {picked !== null && mine && !right && (
                <span dir="rtl" className="flex items-center gap-1 text-xs font-semibold text-warn">
                  <Icon name="x" size={14} strokeWidth={2.4} />
                  בחרת
                </span>
              )}
            </button>
          );
        })}
      </div>

      {picked !== null && (
        <>
          <div className="surface flex flex-col gap-1 rounded-[14px] px-3.5 py-3">
            <span className={`text-[13px] ${picked === turn.answer ? "font-semibold text-accent" : "muted"}`}>
              {picked === turn.answer ? "נכון!" : "התשובה הטבעית"}
            </span>
            <span className="text-[15px]">
              <span dir="ltr" lang="en" className="font-semibold">{turn.options[turn.answer]}</span> · {turn.answerHe}
            </span>
          </div>
          <button className="btn h-14 rounded-2xl text-[17px]" onClick={onNext}>המשך</button>
        </>
      )}
    </div>
  );
}

function Bubble({ side, text }: { side: "they" | "you"; text: string }) {
  // In RTL, "they" sits on the right (start) and "you" on the left (end), like a chat.
  return (
    <p
      dir="ltr"
      lang="en"
      className={`m-0 max-w-[78%] px-3.5 py-2.5 text-base ${
        side === "they"
          ? "rounded-[18px] rounded-br-md border border-line bg-surface"
          : "rounded-[18px] rounded-bl-md bg-accent text-on-accent"
      }`}
    >
      {text}
    </p>
  );
}
