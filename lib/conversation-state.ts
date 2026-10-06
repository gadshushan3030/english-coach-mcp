import type { Dialogue } from "./content";

export type ConversationDraft = {
  version: 1;
  dialogueId: string;
  requestId: string;
  turn: number;
  picks: number[];
  saved: boolean;
};

export function conversationStorageKey(learnerKey: string, dialogueId: string) {
  return `english-coach:conversation:v1:${encodeURIComponent(learnerKey)}:${encodeURIComponent(dialogueId)}`;
}

// A refreshed page may restore only a complete, internally consistent snapshot.
export function parseConversationDraft(raw: string | null, dialogue: Dialogue): ConversationDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ConversationDraft;
    if (value.version !== 1 || value.dialogueId !== dialogue.id || typeof value.requestId !== "string" || !/^[\w-]{8,64}$/.test(value.requestId) ||
      !Number.isInteger(value.turn) || value.turn < 0 || value.turn > dialogue.turns.length ||
      typeof value.saved !== "boolean" || !Array.isArray(value.picks) ||
      value.picks.length < value.turn || value.picks.length > Math.min(value.turn + 1, dialogue.turns.length) ||
      !value.picks.every((pick, index) => Number.isInteger(pick) && pick >= 0 && pick < dialogue.turns[index].options.length) ||
      (value.saved && value.turn !== dialogue.turns.length)) return null;
    return { version: 1, dialogueId: dialogue.id, requestId: value.requestId, turn: value.turn, picks: value.picks, saved: value.saved };
  } catch {
    return null;
  }
}

export function createConversationDraft(dialogueId: string, requestId: string): ConversationDraft {
  return { version: 1, dialogueId, requestId, turn: 0, picks: [], saved: false };
}

// A successful request is only confirmation when the server returns a complete,
// consistent saved result. Replays may return another tab's original answers.
export function confirmConversationDraft(draft: ConversationDraft, result: unknown, dialogue: Dialogue): ConversationDraft | null {
  if (draft.dialogueId !== dialogue.id || draft.turn !== dialogue.turns.length ||
      !result || typeof result !== "object") return null;
  const value = result as { picks?: unknown; correct?: unknown; total?: unknown };
  if (!Array.isArray(value.picks)) return null;
  const picks = Array.from(value.picks);
  if (picks.length !== dialogue.turns.length ||
      !picks.every((pick, index) => Number.isInteger(pick) && pick >= 0 && pick < dialogue.turns[index].options.length) ||
      value.total !== dialogue.turns.length ||
      value.correct !== picks.filter((pick, index) => pick === dialogue.turns[index].answer).length) return null;
  return { ...draft, picks, saved: true };
}

export function pickConversationAnswer(draft: ConversationDraft, pick: number, dialogue: Dialogue): ConversationDraft {
  if (draft.turn >= dialogue.turns.length || draft.picks.length !== draft.turn ||
    !Number.isInteger(pick) || pick < 0 || pick >= dialogue.turns[draft.turn].options.length) return draft;
  return { ...draft, picks: [...draft.picks, pick] };
}

export function advanceConversation(draft: ConversationDraft, dialogue: Dialogue): ConversationDraft {
  if (draft.turn >= dialogue.turns.length || draft.picks.length !== draft.turn + 1) return draft;
  return { ...draft, turn: draft.turn + 1 };
}
