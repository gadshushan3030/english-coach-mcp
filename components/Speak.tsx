"use client";

// Browser text-to-speech; works in Safari on Mac and iPhone without any API key.
export function Speak({ text }: { text: string }) {
  return (
    <button
      type="button"
      aria-label="השמעה"
      className="inline-flex size-11 items-center justify-center rounded-full text-xl hover:bg-black/5 dark:hover:bg-white/10"
      onClick={() => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = 0.9;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }}
    >
      🔊
    </button>
  );
}
