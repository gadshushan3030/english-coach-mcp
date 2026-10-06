export type SpeechState =
  | { status: "idle" | "loading" | "speaking" }
  | { status: "error"; message: string };

type SpeechSession = {
  synth: SpeechSynthesis;
  utterance: SpeechSynthesisUtterance;
  notify: (state: SpeechState) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

// All speaker buttons share the browser's queue. Keep ownership explicit so an
// old button's cancellation, timeout or unmount cannot stop a newer request.
let active: SpeechSession | null = null;
const START_TIMEOUT_MS = 8000;
const NO_START = "ההקראה לא התחילה. לחצו שוב על הרמקול; אם זה חוזר, בדקו שיש קול באנגלית במכשיר.";
const GENERIC_ERROR = "לא הצלחנו להשמיע. אפשר ללחוץ שוב על הרמקול ולנסות מחדש.";

function synthesis() {
  if (typeof window === "undefined" || !window.speechSynthesis
    || typeof window.SpeechSynthesisUtterance !== "function") return null;
  return window.speechSynthesis;
}

function englishVoice(synth: SpeechSynthesis) {
  const voices = synth.getVoices().filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang));
  const score = (voice: SpeechSynthesisVoice) => (voice.localService ? 100 : 0)
    + (/^en[-_]us$/i.test(voice.lang) ? 20 : 0) + (voice.default ? 1 : 0);
  return voices.sort((a, b) => score(b) - score(a))[0] ?? null;
}

// Voice enumeration can initialize asynchronously. Warm it before the first
// tap, but never delay speak() outside that tap just to wait for voices.
export function prepareSpeechVoices() {
  const synth = synthesis();
  if (!synth) return () => {};
  const refresh = () => {
    try { synth.getVoices(); } catch { /* The click path reports engine errors. */ }
  };
  refresh();
  try {
    synth.addEventListener("voiceschanged", refresh);
    return () => synth.removeEventListener("voiceschanged", refresh);
  } catch {
    return () => {};
  }
}

function settle(session: SpeechSession, state: SpeechState, cancel: boolean) {
  if (active !== session) return;
  active = null;
  if (session.timer) clearTimeout(session.timer);
  session.utterance.onstart = null;
  session.utterance.onend = null;
  session.utterance.onerror = null;
  if (cancel) {
    try { session.synth.cancel(); } catch { /* Cleanup must still release ownership. */ }
  }
  session.notify(state);
}

function errorMessage(code: string) {
  switch (code) {
    case "canceled":
    case "interrupted":
      return "ההקראה הופסקה. אפשר ללחוץ שוב על הרמקול ולנסות מחדש.";
    case "not-allowed":
      return "הדפדפן חסם את ההקראה. לחיצה נוספת על הרמקול תנסה שוב.";
    case "language-unavailable":
    case "voice-unavailable":
    case "synthesis-unavailable":
      return "אין קול אנגלי זמין להקראה. אפשר להוסיף קול באנגלית בהגדרות המכשיר או לנסות בדפדפן אחר.";
    case "network":
      return "לא הצלחנו לטעון את הקול. בדקו את החיבור ונסו שוב.";
    case "audio-busy":
    case "audio-hardware":
      return "לא הצלחנו להפעיל את השמע. בדקו את יציאת השמע של המכשיר ונסו שוב.";
    default:
      return GENERIC_ERROR;
  }
}

export function speakEnglish(text: string, notify: (state: SpeechState) => void): () => void {
  const replacing = active !== null;
  if (active) settle(active, { status: "idle" }, true);
  const synth = synthesis();
  if (!synth) {
    notify({ status: "error", message: "הדפדפן לא תומך בהקראה. אפשר לנסות בדפדפן מעודכן." });
    return () => {};
  }
  if (!text.trim()) {
    notify({ status: "error", message: "אין טקסט להשמעה." });
    return () => {};
  }

  let session: SpeechSession | null = null;
  try {
    const utterance = new window.SpeechSynthesisUtterance(text);
    // A temporarily empty catalogue still permits the browser's en-US default.
    const voice = englishVoice(synth);
    utterance.lang = voice?.lang ?? "en-US";
    if (voice) utterance.voice = voice;
    utterance.rate = 0.9;
    const request: SpeechSession = { synth, utterance, notify, timer: null };
    session = request;
    active = request;
    utterance.onstart = () => {
      if (active !== request) return;
      if (request.timer) clearTimeout(request.timer);
      notify({ status: "speaking" });
      // Also recover if the browser starts speech but loses its terminal event.
      request.timer = setTimeout(() => settle(request, {
        status: "error", message: GENERIC_ERROR,
      }, true), Math.max(15000, Math.min(180000, text.length * 150 + 5000)));
    };
    utterance.onend = () => settle(request, { status: "idle" }, false);
    // Our stop/replacement detaches handlers first. A cancellation reaching this
    // current handler is unexpected and needs visible retry feedback as well.
    utterance.onerror = (event) => settle(request,
      { status: "error", message: errorMessage(event.error) }, false);

    notify({ status: "loading" });
    request.timer = setTimeout(() => settle(request, { status: "error", message: NO_START }, true), START_TIMEOUT_MS);
    // Avoid cancel() on an idle engine: some older engines race cancel/speak.
    // cancel() does not reset pause, so resume explicitly before enqueueing.
    if (!replacing && (synth.speaking || synth.pending)) synth.cancel();
    if (synth.paused) synth.resume();
    synth.speak(utterance);
    return () => settle(request, { status: "idle" }, true);
  } catch {
    if (session) settle(session, { status: "error", message: GENERIC_ERROR }, true);
    else notify({ status: "error", message: GENERIC_ERROR });
    return () => {};
  }
}
