"use client";

import { Icon } from "@/components/Icon";

// Browser text-to-speech; works in Safari on Mac and iPhone without any API key.
export function Speak({ text, label = "השמעה", large = false }: { text: string; label?: string; large?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-ground text-accent ${large ? "size-13" : "size-11"}`}
      onClick={() => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = 0.9;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }}
    >
      <Icon name="speaker" size={large ? 24 : 20} />
    </button>
  );
}
