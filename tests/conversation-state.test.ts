import assert from "node:assert/strict";
import { test } from "node:test";
import { DIALOGUES } from "../lib/content";
import {
  advanceConversation,
  confirmConversationDraft,
  conversationStorageKey,
  createConversationDraft,
  parseConversationDraft,
  pickConversationAnswer,
} from "../lib/conversation-state";

const dialogue = DIALOGUES[0];
const id = "run-refresh-123";

function finish() {
  let draft = createConversationDraft(dialogue.id, id);
  for (const turn of dialogue.turns) {
    draft = pickConversationAnswer(draft, turn.answer, dialogue);
    draft = advanceConversation(draft, dialogue);
  }
  return draft;
}

test("a restored answer stays selected until continuation and retains its save request ID", () => {
  const initial = createConversationDraft(dialogue.id, id);
  const answered = pickConversationAnswer(initial, 2, dialogue);
  const restored = parseConversationDraft(JSON.stringify(answered), dialogue)!;
  assert.deepEqual(restored.picks, [2]);
  assert.equal(restored.turn, 0);
  assert.equal(restored.requestId, id);
  const continued = advanceConversation(restored, dialogue);
  assert.equal(continued.turn, 1);
  assert.deepEqual(continued.picks, [2]);
  assert.equal(continued.requestId, id);
});

test("duplicate choices and repeated continuation clicks cannot append or skip answers", () => {
  const initial = createConversationDraft(dialogue.id, id);
  assert.equal(advanceConversation(initial, dialogue), initial);
  const answered = pickConversationAnswer(initial, 1, dialogue);
  assert.equal(pickConversationAnswer(answered, 2, dialogue), answered);
  const next = advanceConversation(answered, dialogue);
  assert.equal(advanceConversation(next, dialogue), next);
  assert.equal(pickConversationAnswer(next, 99, dialogue), next);
  assert.equal(pickConversationAnswer(next, 0.5, dialogue), next);
});

test("refreshing completed but unconfirmed practice can retry the exact same payload", () => {
  const completed = finish();
  const restored = parseConversationDraft(JSON.stringify(completed), dialogue)!;
  assert.deepEqual(restored, completed);
  assert.equal(restored.saved, false);
  assert.equal(restored.requestId, id);
  assert.equal(restored.turn, dialogue.turns.length);
  assert.equal(advanceConversation(restored, dialogue), restored);
  assert.equal(pickConversationAnswer(restored, 0, dialogue), restored);
  const confirmed = { ...restored, saved: true };
  assert.deepEqual(parseConversationDraft(JSON.stringify(confirmed), dialogue), confirmed);
});

test("invalid and mismatched local snapshots cannot become answers or confirmed sessions", () => {
  const initial = createConversationDraft(dialogue.id, id);
  for (const value of [
    null,
    "{",
    "null",
    JSON.stringify({ ...initial, version: 2 }),
    JSON.stringify({ ...initial, dialogueId: "different-dialogue" }),
    JSON.stringify({ ...initial, requestId: "tiny" }),
    JSON.stringify({ ...initial, requestId: 123456789 }),
    JSON.stringify({ ...initial, turn: 1, picks: [] }),
    JSON.stringify({ ...initial, turn: -1 }),
    JSON.stringify({ ...initial, turn: 0.5 }),
    JSON.stringify({ ...initial, turn: 4, picks: [0, 0, 0] }),
    JSON.stringify({ ...initial, picks: [0, 1] }),
    JSON.stringify({ ...initial, picks: [99] }),
    JSON.stringify({ ...initial, picks: [null] }),
    JSON.stringify({ ...initial, picks: [0.5] }),
    JSON.stringify({ ...initial, saved: true }),
  ]) assert.equal(parseConversationDraft(value, dialogue), null, String(value));
});

test("draft keys separate users, dates, dialogues and delimiter characters", () => {
  const key = conversationStorageKey("user-one:2026-10-06", dialogue.id);
  assert.notEqual(key, conversationStorageKey("user-two:2026-10-06", dialogue.id));
  assert.notEqual(key, conversationStorageKey("user-one:2026-10-07", dialogue.id));
  assert.notEqual(key, conversationStorageKey("user-one:2026-10-06", DIALOGUES[1].id));
  assert.notEqual(conversationStorageKey("a:b", "c"), conversationStorageKey("a", "b:c"));
});

test("server confirmation replaces divergent local answers with the first stored answers", () => {
  const completed = finish();
  const result = { picks: [1, 1, 2], correct: 2, total: 3 };
  const confirmed = confirmConversationDraft(completed, result, dialogue)!;
  assert.equal(confirmed.saved, true);
  assert.equal(confirmed.requestId, completed.requestId);
  assert.deepEqual(confirmed.picks, [1, 1, 2]);
  assert.deepEqual(completed.picks, [0, 1, 2]);
  result.picks[0] = 0;
  assert.deepEqual(confirmed.picks, [1, 1, 2]);
  assert.deepEqual(parseConversationDraft(JSON.stringify(confirmed), dialogue), confirmed);
});

test("missing, partial and inconsistent server replies never confirm a conversation", () => {
  const completed = finish();
  for (const result of [
    undefined, null, {},
    { picks: [0], correct: 1, total: 3 },
    { picks: [0, 1, 2], correct: 3, total: 2 },
    { picks: [0, 1, 2], correct: 0, total: 3 },
    { picks: [0, 1, 99], correct: 2, total: 3 },
    { picks: [0, 1, null], correct: 2, total: 3 },
    { picks: new Array(3), correct: 0, total: 3 },
    { picks: [0, 1, 2], correct: "3", total: 3 },
  ]) assert.equal(confirmConversationDraft(completed, result, dialogue), null);
  assert.equal(confirmConversationDraft(createConversationDraft(dialogue.id, id), { picks: [0, 1, 2], correct: 3, total: 3 }, dialogue), null);
});
