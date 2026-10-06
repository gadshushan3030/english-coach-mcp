"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { saveConversation } from "@/app/actions";
import { Icon } from "@/components/Icon";
import { Speak } from "@/components/Speak";
import { TopBar } from "@/components/TopBar";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import type { Dialogue } from "@/lib/content";
import {
  advanceConversation,
  confirmConversationDraft,
  conversationStorageKey,
  createConversationDraft,
  parseConversationDraft,
  pickConversationAnswer,
  type ConversationDraft,
} from "@/lib/conversation-state";

function newRequestId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `run-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

// `shift` rotates the answer order per day, so the right answer isn't always in the same spot.
export function Conversation({
  dialogue,
  nextId,
  shift,
  doneToday,
  learnerId,
  learnerKey,
  onComplete,
  embedded = false,
}: {
  dialogue: Dialogue;
  nextId: string;
  shift: number;
  doneToday: { correct: number; total: number } | null;
  /** Authenticated identity rendered by the server; the action verifies it again. */
  learnerId: string;
  /** User and date scope, supplied by the authenticated server page. */
  learnerKey?: string;
  /** Only pass a callback from another Client Component. */
  onComplete?: () => void;
  embedded?: boolean;
}) {
  const [draft, setDraft] = useState<ConversationDraft | null>(null);
  const draftRef = useRef<ConversationDraft | null>(null);
  const loadedKey = useRef<string | null>(null);
  const saving = useRef(false);
  const notified = useRef(false);
  const [saveError, setSaveError] = useState(false);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [reconciled, setReconciled] = useState(false);
  const [pending, startTransition] = useTransition();
  const storageKey = learnerKey ? conversationStorageKey(learnerKey, dialogue.id) : null;

  const commit = useCallback((next: ConversationDraft) => {
    draftRef.current = next;
    setDraft(next);
    if (storageKey) {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        setStorageNotice("הדפדפן לא מאפשר לשמור את התרגול המקומי. כדאי לסיים לפני רענון העמוד.");
      }
    }
  }, [storageKey]);

  useEffect(() => {
    const scope = storageKey ?? `${learnerId}:${dialogue.id}`;
    if (loadedKey.current === scope) return;
    let active = true;
    // Restore after hydration so server and browser first render the same markup.
    queueMicrotask(() => {
      if (!active) return;
      let previous: ConversationDraft | null = null;
      if (storageKey) {
        try {
          previous = parseConversationDraft(sessionStorage.getItem(storageKey), dialogue);
        } catch {
          setStorageNotice("הדפדפן לא מאפשר לשמור את התרגול המקומי. כדאי לסיים לפני רענון העמוד.");
        }
      }
      const requestId = newRequestId();
      loadedKey.current = scope;
      notified.current = false;
      setSaveError(false);
      setReconciled(false);
      setRestored(Boolean(previous && previous.picks.length > 0 && !previous.saved));
      commit(previous ?? createConversationDraft(dialogue.id, requestId));
    });
    return () => { active = false; };
  }, [dialogue, learnerId, storageKey, commit]);

  const save = useCallback(() => {
    const current = draftRef.current;
    if (!current || current.saved || current.turn !== dialogue.turns.length || saving.current) return;
    saving.current = true;
    const scope = loadedKey.current;
    setSaveError(false);
    startTransition(async () => {
      try {
        const result = await saveConversation(current.requestId, dialogue.id, current.picks, learnerId);
        const confirmed = confirmConversationDraft(current, result, dialogue);
        if (!confirmed) throw new Error("Incomplete conversation confirmation");
        if (draftRef.current?.requestId === current.requestId && loadedKey.current === scope) {
          setReconciled(confirmed.picks.some((pick, index) => pick !== current.picks[index]));
          commit(confirmed);
        }
      } catch {
        if (draftRef.current?.requestId === current.requestId && loadedKey.current === scope) setSaveError(true);
      } finally {
        saving.current = false;
      }
    });
  }, [dialogue, learnerId, commit]);

  useEffect(() => {
    if (draft && draft.turn === dialogue.turns.length && !draft.saved && !saveError) save();
  }, [draft, dialogue.turns.length, saveError, save]);

  useEffect(() => {
    if (draft?.saved && onComplete && !notified.current) {
      notified.current = true;
      onComplete();
    }
  }, [draft?.saved, onComplete]);

  const n = dialogue.turns.length;
  const finished = Boolean(draft && draft.turn >= n);
  const unconfirmed = finished && !draft?.saved;

  useEffect(() => {
    if (!unconfirmed) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const preventLinkNavigation = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest("a[href]")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", preventLinkNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", preventLinkNavigation, true);
    };
  }, [unconfirmed]);

  const advance = () => {
    const current = draftRef.current;
    if (current) commit(advanceConversation(current, dialogue));
  };

  const restart = () => {
    if (!draftRef.current?.saved || embedded) return;
    notified.current = false;
    setSaveError(false);
    setRestored(false);
    setReconciled(false);
    commit(createConversationDraft(dialogue.id, newRequestId()));
  };

  const score = draft?.picks.filter((pick, index) => pick === dialogue.turns[index].answer).length ?? 0;

  return (
    <section data-focus className="flex flex-col gap-3.5">
      {!embedded && (unconfirmed ? (
        <div className="flex h-11 items-center justify-between gap-2">
          <button type="button" aria-label="חזרה לבית אחרי השמירה" disabled className="flex size-11 items-center justify-center rounded-full border border-line opacity-50"><Icon name="back" size={20} /></button>
          <span className="font-semibold">שיחה יומית</span>
          <span className="muted font-mono text-[13px]">{n}/{n}</span>
        </div>
      ) : <TopBar title="שיחה יומית" end={`${Math.min((draft?.turn ?? 0) + 1, n)}/${n}`} />)}
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[22px] font-bold">{dialogue.title}</h1>
        {"level" in dialogue && typeof dialogue.level === "string" && <p className="muted text-xs">רמת התרגול בשיחה: {dialogue.level}</p>}
        <p className={`text-[13px] ${doneToday ? "text-accent" : "muted"}`}>
          {doneToday ? `תורגלה היום · ${doneToday.correct}/${doneToday.total}` : `${n} משפטים · 2 דקות`}
        </p>
      </div>
      {restored && <p role="status" className="text-xs text-accent">המשכנו מהמקום שבו עצרת.</p>}
      {storageNotice && <p role="status" className="text-xs text-warn">{storageNotice}</p>}
      {!draft && <p role="status" className="muted text-sm">פותחים את התרגול…</p>}

      <div className="flex flex-col gap-2">
        {dialogue.turns.slice(0, draft?.turn ?? 0).map((turn, index) => (
          <div key={index} className="flex flex-col items-start gap-2">
            <Bubble side="they" text={turn.they} />
            <div className="flex flex-col items-end gap-1 self-stretch">
              <Bubble side="you" text={turn.options[turn.answer]} />
              {draft?.picks[index] === turn.answer ? (
                <span className="flex items-center gap-1 text-xs text-accent"><Icon name="check" size={13} strokeWidth={2.4} />נכון</span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-warn"><Icon name="x" size={13} strokeWidth={2.4} />בחרת: <span dir="ltr" lang="en">{turn.options[draft?.picks[index] ?? 0]}</span></span>
              )}
            </div>
          </div>
        ))}
      </div>

      {draft && !finished && (
        <Current key={draft.turn} turn={dialogue.turns[draft.turn]} shift={shift + draft.turn}
          picked={draft.picks[draft.turn] ?? null}
          onPick={(pick) => {
            const current = draftRef.current;
            if (current) commit(pickConversationAnswer(current, pick, dialogue));
          }}
          onNext={advance} />
      )}

      {finished && (
        <div className="surface flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-3xl font-bold tabular-nums">{score}/{n}</p>
          <p role={saveError ? "alert" : "status"} className={`text-sm ${saveError ? "text-warn" : "muted"}`}>
            {pending ? "בשמירה…" : saveError ? (storageKey && !storageNotice ? "השמירה נכשלה. התשובות נשמרו בדפדפן; אפשר לנסות שוב." : "השמירה נכשלה. אפשר לנסות שוב לפני שעוזבים את העמוד.") : draft?.saved ? "נשמר בהתקדמות" : "מכינים לשמירה…"}
          </p>
          {reconciled && <p role="status" className="text-xs text-accent">השיחה כבר נשמרה בלשונית אחרת. מוצגות הבחירות שנשמרו.</p>}
          {saveError && <button type="button" className="btn" disabled={pending} onClick={save}>ניסיון שמירה נוסף</button>}
          {unconfirmed && <p className="muted text-xs">אפשר להמשיך אחרי שהשמירה תושלם.</p>}
          {!embedded && (draft?.saved ? (
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className="btn btn-ghost" onClick={restart}>תרגול חוזר</button>
              <Link href={`/talk?d=${nextId}`} className="btn">שיחה נוספת</Link>
              <Link href="/" className="btn btn-ghost">לדף הבית</Link>
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className="btn" disabled>שיחה נוספת</button>
              <button type="button" className="btn btn-ghost" disabled>לדף הבית</button>
            </div>
          ))}
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
        <div className="flex flex-wrap items-center gap-1.5">
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
          <VoiceRecorder prompt={turn.options[turn.answer]} />
          <button type="button" className="btn h-14 rounded-2xl text-[17px]" onClick={onNext}>המשך</button>
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
