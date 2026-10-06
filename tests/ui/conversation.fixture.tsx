import { createRoot } from "react-dom/client";
import { Conversation } from "../../app/(main)/talk/Conversation";
import { DIALOGUES } from "../../lib/content";

type Attempt = { requestId: string; dialogueId: string; picks: number[]; expectedUserId: string };
type Mock = {
  calls: Attempt[];
  completions: number;
  micRequests: number;
  tracksStopped: number;
  urlsCreated: number;
  urlsRevoked: number;
  recordedBlobs: { bytes: number; type: string }[];
  nativeAudio: boolean;
  audioResources: { context: AudioContext; stream: MediaStream }[];
  nativeRecorders: MediaRecorder[];
  nativeEvents: { event: string; at: number; detail?: unknown }[];
  disposeAudio: () => Promise<void>;
  micMode: "denied" | "success" | "deferred";
  currentUserId: string;
  save: (requestId: string, dialogueId: string, picks: number[], expectedUserId: string) => Promise<unknown>;
  resolve: (picks?: number[]) => void;
  resolveResult: (result: unknown) => void;
  reject: () => void;
  resolveMic: () => void;
  unsupported: () => void;
  revalidate: () => void;
};

declare global {
  interface Window { conversationMock: Mock }
}

const nativeAudio = new URLSearchParams(location.search).get("native_audio") === "1";
const learnerId = new URLSearchParams(location.search).get("learner") ?? "user-one";
const callsKey = "conversation-fixture-calls";
let current: { resolve: (result: unknown) => void; reject: (error: Error) => void; attempt: Attempt } | null = null;
let micResolve: ((stream: MediaStream) => void) | null = null;
const root = createRoot(document.getElementById("root")!);
const complete = () => { window.conversationMock.completions++; };

function render() {
  root.render(<Conversation dialogue={DIALOGUES[0]} nextId={DIALOGUES[1].id} shift={0} doneToday={null}
    learnerId={learnerId} learnerKey={`${learnerId}:2026-10-06`}
    onComplete={complete} />);
}

function fakeStream() {
  let ended = false;
  return { getTracks: () => [{ stop() { if (!ended) { ended = true; window.conversationMock.tracksStopped++; } } }] } as unknown as MediaStream;
}

class FakeMediaRecorder {
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  static isTypeSupported() { return true; }
  start() { this.state = "recording"; }
  stop() {
    if (this.state === "inactive") throw new Error("Cannot stop an inactive recorder");
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["test-audio"], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}

if (!nativeAudio) Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeMediaRecorder });
else {
  const originalStart = MediaRecorder.prototype.start;
  const originalStop = MediaRecorder.prototype.stop;
  MediaRecorder.prototype.start = function (timeslice?: number) {
    window.conversationMock.nativeRecorders.push(this);
    for (const event of ["start", "dataavailable", "stop", "error"]) {
      this.addEventListener(event, (value) => {
        const data = value instanceof BlobEvent ? value.data : null;
        const error = (value as Event & { error?: DOMException }).error;
        window.conversationMock.nativeEvents.push({ event, at: performance.now(), detail: {
          state: this.state,
          contextTime: window.conversationMock.audioResources[0]?.context.currentTime,
          ...(data ? { bytes: data.size, type: data.type } : {}),
          ...(error ? { error: error.name, message: error.message } : {}),
        } });
      });
    }
    window.conversationMock.nativeEvents.push({ event: "start-called", at: performance.now(), detail: { mimeType: this.mimeType, timeslice } });
    originalStart.call(this, timeslice);
  };
  MediaRecorder.prototype.stop = function () {
    window.conversationMock.nativeEvents.push({ event: "stop-called", at: performance.now(), detail: { state: this.state } });
    originalStop.call(this);
  };
}
Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
  getUserMedia: async () => {
    window.conversationMock.micRequests++;
    if (nativeAudio) {
      // Exercise the real browser encoder/decoder with a known signal while
      // keeping physical microphone capture and OS permissions out of this QA.
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 440;
      gain.gain.value = 0.1;
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start();
      const stream = destination.stream;
      let disposed = false;
      for (const track of stream.getTracks()) {
        const originalStop = track.stop.bind(track);
        Object.defineProperty(track, "stop", { value: () => {
          if (disposed) return;
          disposed = true;
          originalStop();
          window.conversationMock.nativeEvents.push({ event: "track-stopped", at: performance.now(), detail: { contextState: context.state, contextTime: context.currentTime } });
          window.conversationMock.tracksStopped++;
          oscillator.stop();
          oscillator.disconnect();
          gain.disconnect();
          destination.disconnect();
          void context.close();
        } });
      }
      window.conversationMock.audioResources.push({ context, stream });
      await context.resume();
      window.conversationMock.nativeEvents.push({ event: "stream-created", at: performance.now(), detail: { contextState: context.state, contextTime: context.currentTime, trackStates: stream.getTracks().map((track) => track.readyState) } });
      return stream;
    }
    if (window.conversationMock.micMode === "denied") throw new DOMException("Fixture denial", "NotAllowedError");
    if (window.conversationMock.micMode === "deferred") return new Promise<MediaStream>((resolve) => { micResolve = resolve; });
    return fakeStream();
  },
} });
const originalCreateUrl = URL.createObjectURL.bind(URL);
const originalRevokeUrl = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob) => {
  window.conversationMock.urlsCreated++;
  if (blob instanceof Blob) window.conversationMock.recordedBlobs.push({ bytes: blob.size, type: blob.type });
  return originalCreateUrl(blob);
};
URL.revokeObjectURL = (url) => { window.conversationMock.urlsRevoked++; originalRevokeUrl(url); };

window.conversationMock = {
  calls: JSON.parse(sessionStorage.getItem(callsKey) ?? "[]"),
  completions: 0,
  micRequests: 0,
  tracksStopped: 0,
  urlsCreated: 0,
  urlsRevoked: 0,
  recordedBlobs: [],
  nativeAudio,
  audioResources: [],
  nativeRecorders: [],
  nativeEvents: [],
  async disposeAudio() {
    document.querySelector("audio")?.pause();
    root.unmount();
    for (const { stream } of this.audioResources) stream.getTracks().forEach((track) => track.stop());
    await Promise.all(this.audioResources.filter(({ context }) => context.state !== "closed").map(({ context }) => context.close()));
  },
  micMode: "denied",
  currentUserId: learnerId,
  save(requestId, dialogueId, picks, expectedUserId) {
    const attempt = { requestId, dialogueId, picks: [...picks], expectedUserId };
    this.calls.push(attempt);
    sessionStorage.setItem(callsKey, JSON.stringify(this.calls));
    if (expectedUserId !== this.currentUserId) return Promise.reject(new Error("Fixture account changed"));
    return new Promise((resolve, reject) => { current = { resolve, reject, attempt }; });
  },
  resolve(picks) {
    if (!current) throw new Error("No pending conversation save");
    const dialogue = DIALOGUES.find(({ id }) => id === current!.attempt.dialogueId)!;
    const saved = picks ?? current.attempt.picks;
    this.resolveResult({ picks: [...saved], correct: saved.filter((pick, index) => pick === dialogue.turns[index].answer).length, total: dialogue.turns.length });
  },
  resolveResult(result) {
    if (!current) throw new Error("No pending conversation save");
    current.resolve(result);
    current = null;
  },
  reject() {
    if (!current) throw new Error("No pending conversation save");
    current.reject(new Error("Fixture save failed"));
    current = null;
  },
  resolveMic() {
    if (!micResolve) throw new Error("No pending microphone request");
    micResolve(fakeStream());
    micResolve = null;
  },
  unsupported() { Object.defineProperty(window, "MediaRecorder", { configurable: true, value: undefined }); },
  revalidate: render,
};
render();
