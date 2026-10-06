"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { prepareSpeechVoices, speakEnglish, type SpeechState } from "@/lib/browser-speech";

type SpeakProps = { text: string; label?: string; large?: boolean };

export function Speak(props: SpeakProps) {
  return <SpeechButton key={props.text} {...props} />;
}

function SpeechButton({ text, label = "השמעה", large = false }: SpeakProps) {
  const [state, setState] = useState<SpeechState>({ status: "idle" });
  const stop = useRef<(() => void) | null>(null);
  const mounted = useRef(false);
  const messageId = useId();
  const playing = state.status === "loading" || state.status === "speaking";
  const message = state.status === "error" ? state.message
    : state.status === "loading" ? "מכינים הקראה…"
      : state.status === "speaking" ? "משמיע…" : null;

  useEffect(() => {
    mounted.current = true;
    const releaseVoices = prepareSpeechVoices();
    return () => {
      mounted.current = false;
      stop.current?.();
      stop.current = null;
      releaseVoices();
    };
  }, []);

  return (
    <span className="contents">
      <button
        type="button"
        aria-label={playing ? `עצירת ${label}` : state.status === "error" ? `ניסיון נוסף: ${label}` : label}
        aria-pressed={playing}
        aria-busy={state.status === "loading"}
        aria-describedby={message ? messageId : undefined}
        className={`inline-flex shrink-0 items-center justify-center rounded-full border border-line text-accent ${playing ? "bg-accent-soft" : "bg-ground"} ${large ? "size-13" : "size-11"}`}
        onClick={() => {
          if (playing) {
            stop.current?.();
            stop.current = null;
            return;
          }
          stop.current = speakEnglish(text, (next) => {
            if (mounted.current) setState(next);
          });
        }}
      >
        <Icon name="speaker" size={large ? 24 : 20} />
      </button>
      {message && <span id={messageId} role={state.status === "error" ? "alert" : "status"}
        className={`order-last w-full self-stretch break-words text-center text-xs ${state.status === "error" ? "text-warn" : "text-muted"}`}>
        {message}
      </span>}
    </span>
  );
}
