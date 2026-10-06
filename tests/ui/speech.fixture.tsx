import { createRoot } from "react-dom/client";
import { Speak } from "../../components/Speak";
import { Conversation } from "../../app/(main)/talk/Conversation";

type SpeechCall = {
  action: "getVoices" | "cancel" | "resume" | "speak";
  text?: string;
  lang?: string;
  rate?: number;
  voiceLang?: string | null;
  voiceName?: string | null;
  inClickStack?: boolean;
};
type SpeechMock = {
  calls: SpeechCall[];
  utterances: FakeUtterance[];
  handlers: Pick<FakeUtterance, "onstart" | "onend" | "onerror">[];
  clickDepth: number;
  synthesis: FakeSynthesis;
  start: (index?: number) => void;
  end: (index?: number) => void;
  error: (code: string, index?: number) => void;
  capturedError: (code: string, index: number) => void;
  capturedEnd: (index: number) => void;
  withoutLocalUS: () => void;
  loadVoices: () => void;
  setPaused: (paused: boolean) => void;
  throwNextSpeak: () => void;
  remove: (id: "first" | "second") => void;
  setText: (text: string) => void;
  mount: () => void;
  dispose: () => void;
};

declare global {
  interface Window { speechMock: SpeechMock }
}

class FakeUtterance extends EventTarget {
  text: string;
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: ((event: SpeechSynthesisEvent) => void) | null = null;
  onend: ((event: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;

  constructor(text = "") { super(); this.text = text; }

  emit(type: "start" | "end" | "error", code?: string) {
    const event = Object.assign(new Event(type), { utterance: this, elapsedTime: 0, charIndex: 0, ...(code ? { error: code } : {}) });
    this.dispatchEvent(event);
    if (type === "start") this.onstart?.(event as unknown as SpeechSynthesisEvent);
    if (type === "end") this.onend?.(event as unknown as SpeechSynthesisEvent);
    if (type === "error") this.onerror?.(event as unknown as SpeechSynthesisErrorEvent);
  }
}

const englishVoices: SpeechSynthesisVoice[] = [
  { name: "Hebrew default", lang: "he-IL", voiceURI: "fixture-he", localService: true, default: true },
  { name: "English remote", lang: "en-US", voiceURI: "fixture-en-remote", localService: false, default: false },
  { name: "English British local", lang: "en-GB", voiceURI: "fixture-en-gb", localService: true, default: false },
  { name: "English US local", lang: "en-US", voiceURI: "fixture-en-us", localService: true, default: false },
];

class FakeSynthesis extends EventTarget {
  paused = false;
  speaking = false;
  pending = false;
  current: FakeUtterance | null = null;
  failNext = false;
  voices = new URLSearchParams(location.search).get("voices") === "late" ? [] : englishVoices;
  onvoiceschanged: ((event: Event) => void) | null = null;

  getVoices() {
    window.speechMock.calls.push({ action: "getVoices" });
    return this.voices;
  }

  cancel() {
    window.speechMock.calls.push({ action: "cancel" });
    const previous = this.current;
    const wasSpeaking = this.speaking;
    this.current = null;
    this.speaking = false;
    this.pending = false;
    // Some browsers synchronously report cancellation. A replaced utterance
    // must never turn a newly clicked word into an error.
    previous?.emit("error", wasSpeaking ? "interrupted" : "canceled");
  }

  resume() {
    window.speechMock.calls.push({ action: "resume" });
    this.paused = false;
  }

  speak(utterance: FakeUtterance) {
    window.speechMock.calls.push({ action: "speak", text: utterance.text, lang: utterance.lang, rate: utterance.rate,
      voiceLang: utterance.voice?.lang ?? null, voiceName: utterance.voice?.name ?? null, inClickStack: window.speechMock.clickDepth > 0 });
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Fixture engine refused to speak");
    }
    this.current = utterance;
    this.pending = true;
    this.speaking = false;
    window.speechMock.utterances.push(utterance);
    window.speechMock.handlers.push({ onstart: utterance.onstart, onend: utterance.onend, onerror: utterance.onerror });
  }

  loadVoices() {
    this.voices = englishVoices;
    const event = new Event("voiceschanged");
    this.dispatchEvent(event);
    this.onvoiceschanged?.(event);
  }
}

// Accelerate only the controller's eight-second no-start watchdog in its
// dedicated test. React scheduling, normal delays and lifecycle events remain real.
if (new URLSearchParams(location.search).get("timeout") === "fast") {
  const originalSetTimeout = window.setTimeout.bind(window) as (handler: TimerHandler, timeout?: number, ...args: unknown[]) => number;
  Object.defineProperty(window, "setTimeout", { configurable: true, writable: true,
    value: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => originalSetTimeout(handler, timeout === 8000 ? 300 : timeout, ...args) });
}

const synthesis = new FakeSynthesis();
const unsupported = new URLSearchParams(location.search).get("unsupported") === "1";
Object.defineProperty(window, "speechSynthesis", { configurable: true, value: unsupported ? undefined : synthesis });
Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: unsupported ? undefined : FakeUtterance });
const root = createRoot(document.getElementById("root")!);
let visible = { first: true, second: true };
const layout = new URLSearchParams(location.search).get("layout");
const word = layout === "word" ? "sustainability" : "hello";
let firstText = word;
const dialogue = { id: "speech-fixture", title: "הקראת שאלה", turns: [{
  they: "How would you describe sustainability?", theyHe: "איך מתארים קיימות?",
  options: ["It means meeting today's needs while considering the future.", "Tomorrow are yesterday.", "I am a red train."],
  answer: 0, answerHe: "לתת מענה לצרכים של היום תוך התחשבות בעתיד.",
}] };

function render() {
  root.render(<section className="flex flex-col gap-3">
    <h1>תרגול השמעה</h1>
    {visible.first && (layout === "conversation" ? <div key="first" data-speech="first">
      <Conversation dialogue={dialogue} nextId="speech-fixture" shift={0} doneToday={null} learnerId="speech-fixture" learnerKey="speech-fixture" />
    </div> : layout === "word" ? <div key="first" data-speech="first" className="surface rounded-[26px] p-[18px]">
      <div className="flex flex-wrap items-center justify-center gap-2.5 px-1">
        <span dir="ltr" lang="en" className="text-[34px] font-semibold tracking-tight">{firstText}</span>
        <Speak text={firstText} label="השמעת מילה ראשונה" />
      </div>
    </div> : <div key="first" data-speech="first" className="flex flex-wrap items-center gap-2"><span dir="ltr">{firstText}</span><Speak text={firstText} label="השמעת מילה ראשונה" /></div>)}
    {visible.second && <div key="second" data-speech="second" className="flex flex-wrap items-center gap-2"><span dir="ltr">thank you</span><Speak text="thank you" label="השמעת מילה שנייה" /></div>}
  </section>);
}

function emit(type: "start" | "end" | "error", index: number, code?: string) {
  const utterance = window.speechMock.utterances[index];
  if (!utterance) throw new Error(`No utterance at index ${index}`);
  if (synthesis.current === utterance) {
    synthesis.speaking = type === "start";
    synthesis.pending = false;
    if (type !== "start") synthesis.current = null;
  }
  utterance.emit(type, code);
}

window.speechMock = {
  calls: [], utterances: [], handlers: [], clickDepth: 0, synthesis,
  start(index) { emit("start", index ?? window.speechMock.utterances.length - 1); },
  end(index) { emit("end", index ?? window.speechMock.utterances.length - 1); },
  error(code, index) { emit("error", index ?? window.speechMock.utterances.length - 1, code); },
  capturedError(code, index) {
    this.handlers[index]?.onerror?.(Object.assign(new Event("error"), { error: code }) as unknown as SpeechSynthesisErrorEvent);
  },
  capturedEnd(index) { this.handlers[index]?.onend?.(new Event("end") as unknown as SpeechSynthesisEvent); },
  withoutLocalUS() {
    synthesis.voices = englishVoices.filter((voice) => voice.name !== "English US local");
    synthesis.dispatchEvent(new Event("voiceschanged"));
  },
  loadVoices() { synthesis.loadVoices(); },
  setPaused(paused) { synthesis.paused = paused; },
  throwNextSpeak() { synthesis.failNext = true; },
  remove(id) { visible = { ...visible, [id]: false }; render(); },
  setText(text) { firstText = text; render(); },
  mount() { visible = { first: true, second: true }; render(); },
  dispose() { root.unmount(); },
};
document.addEventListener("click", () => { window.speechMock.clickDepth++; }, true);
window.addEventListener("click", () => { window.speechMock.clickDepth--; });
render();
