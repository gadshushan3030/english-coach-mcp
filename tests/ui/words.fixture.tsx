import { createRoot } from "react-dom/client";
import { AddWordForm } from "../../app/(main)/words/AddWordForm";
import { WordList, type ManagedWord } from "../../app/(main)/words/WordList";
import { Deck } from "../../app/(main)/cards/Deck";

type Call = { kind: "add" | "edit" | "archive" | "restore" | "review"; wordId?: string; input?: { english: string; hebrew: string; example?: string | null }; knew?: boolean; requestId?: string };
type Mock = { calls: Call[]; call: (call: Call) => Promise<unknown>; resolve: (canonicalKnew?: boolean) => void; reject: () => void; completeCount: number };
declare global { interface Window { wordMock: Mock } }

let words: ManagedWord[] = [
  { id: "11111111-1111-4111-8111-111111111111", english: "remember", hebrew: "לזכור", example: "I remember my meeting.", status: "new", correct: 1, attempts: 2 },
  { id: "22222222-2222-4222-8222-222222222222", english: "journey", hebrew: "מסע", example: "The journey starts tomorrow.", status: "practice", correct: 0, attempts: 1 },
  { id: "33333333-3333-4333-8333-333333333333", english: "confident", hebrew: "בטוח", example: "I feel confident.", status: "known", correct: 2, attempts: 2 },
];
const archived = new Set<string>();
const root = createRoot(document.getElementById("root")!);
const deckMode = new URLSearchParams(location.search).get("mode") === "deck";
let current: { call: Call; resolve: (value: unknown) => void; reject: (error: Error) => void } | null = null;

function render() {
  if (deckMode) {
    root.render(<Deck words={words.slice(0, 2).map((word) => ({ ...word, box: 0 }))} onComplete={() => {
      window.wordMock.completeCount += 1;
      root.render(<p>המשך לתרגול האישי</p>);
    }} />);
  } else {
    root.render(<><h1 className="text-[26px] font-bold">המילים שלי</h1><AddWordForm /><WordList words={words.filter((word) => !archived.has(word.id))} /></>);
  }
}

window.wordMock = {
  calls: [], completeCount: 0,
  call(call) {
    this.calls.push(call);
    return new Promise((resolve, reject) => { current = { call, resolve, reject }; });
  },
  resolve(canonicalKnew) {
    if (!current) throw new Error("There is no pending word save");
    const pending = current;
    current = null;
    const call = pending.call;
    if (call.kind === "review") {
      pending.resolve({ id: String(this.calls.length), wordId: call.wordId, knew: canonicalKnew ?? call.knew });
      return;
    }
    let id = call.wordId;
    if (call.kind === "archive") archived.add(id!);
    if (call.kind === "restore") archived.delete(id!);
    if (call.kind === "edit") words = words.map((word) => word.id === id ? { ...word, ...call.input!, example: call.input!.example || null } : word);
    if (call.kind === "add") {
      id = "44444444-4444-4444-8444-444444444444";
      words = [...words, { id, ...call.input!, example: call.input!.example || null, status: "new", correct: 0, attempts: 0 }];
    }
    render(); // Mimics action revalidation arriving with fresh server props.
    pending.resolve({ ok: true, id });
  },
  reject() {
    if (!current) throw new Error("There is no pending word save");
    const pending = current; current = null;
    pending.reject(new Error("Simulated lost response"));
  },
};
render();
