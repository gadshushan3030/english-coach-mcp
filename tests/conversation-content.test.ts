import assert from "node:assert/strict";
import { test } from "node:test";
import { DIALOGUES } from "../lib/content";
import {
  ADAPTIVE_DIALOGUES,
  ALL_DIALOGUES,
  chooseAdaptiveDialogue,
  dialogueMetadata,
  nextAdaptiveDialogue,
  resolveDialogue,
  type LearningGoal,
  type LearningLevel,
} from "../lib/adaptive-content";

const goals: LearningGoal[] = ["everyday", "work", "travel"];
const levels: LearningLevel[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];

test("the expanded catalogue preserves legacy identities and provides canonical complete turns", () => {
  assert.equal(ADAPTIVE_DIALOGUES.length, 24);
  assert.equal(ALL_DIALOGUES.length, 34);
  assert.equal(new Set(ALL_DIALOGUES.map((dialogue) => dialogue.id)).size, ALL_DIALOGUES.length);
  for (const dialogue of ALL_DIALOGUES) {
    assert.equal(resolveDialogue(dialogue.id), dialogue);
    assert.ok(dialogue.title.length > 0);
    assert.equal(dialogue.turns.length, 3);
    for (const turn of dialogue.turns) {
      assert.equal(turn.options.length, 3);
      assert.equal(new Set(turn.options).size, 3);
      assert.ok(Number.isInteger(turn.answer) && turn.answer >= 0 && turn.answer < turn.options.length);
      assert.ok(turn.options[turn.answer].trim().length > 0);
      assert.ok(turn.they.trim() && turn.theyHe.trim() && turn.answerHe.trim());
    }
  }
  for (const legacy of DIALOGUES) assert.deepEqual(dialogueMetadata(legacy.id), { goal: "everyday", level: "A1" });
  assert.equal(resolveDialogue("unknown-dialogue"), undefined);
});

test("every goal and level has stable, rotating daily content in its practice band", () => {
  for (const goal of goals) for (const level of levels) {
    const profile = { goal, level };
    const selected = chooseAdaptiveDialogue("2026-10-06", profile);
    const repeat = chooseAdaptiveDialogue("2026-10-06", profile);
    const next = chooseAdaptiveDialogue("2026-10-07", profile);
    assert.equal(selected, repeat);
    assert.notEqual(selected.id, next.id, `${goal}/${level} should rotate`);
    assert.equal(dialogueMetadata(selected.id).goal, goal);
    const expected = level === "A0" || level === "A1" ? "A1" : level === "A2" || level === "B1" ? "A2" : level === "B2" ? "B2" : "C1";
    assert.equal(dialogueMetadata(selected.id).level, expected);
  }
});

test("invalid dates and dates before the epoch retain usable canonical content", () => {
  for (const day of ["not-a-date", "1969-12-31", "2026-01-01"]) {
    const selected = chooseAdaptiveDialogue(day, { goal: "travel", level: "B2" });
    assert.ok(selected);
    assert.equal(resolveDialogue(selected.id), selected);
    assert.deepEqual(dialogueMetadata(selected.id), { goal: "travel", level: "B2" });
  }
});

test("another conversation advances from the current item instead of linking to itself", () => {
  for (const goal of goals) for (const level of levels) {
    const profile = { goal, level };
    const current = chooseAdaptiveDialogue("2026-10-06", profile);
    const next = nextAdaptiveDialogue(current.id, profile);
    const third = nextAdaptiveDialogue(next.id, profile);
    assert.notEqual(current.id, next.id);
    assert.notEqual(next.id, third.id);
    assert.equal(dialogueMetadata(next.id).goal, goal);
  }
});

test("conversation cycling visits every eligible item once before returning to the start", () => {
  for (const goal of goals) for (const level of levels) {
    const profile = { goal, level };
    const initial = chooseAdaptiveDialogue("2026-10-06", profile);
    const seen = new Set([initial.id]);
    let next = nextAdaptiveDialogue(initial.id, profile);
    while (next.id !== initial.id) {
      assert.ok(!seen.has(next.id), `cycle must not repeat ${next.id} early`);
      seen.add(next.id);
      next = nextAdaptiveDialogue(next.id, profile);
      assert.ok(seen.size <= ALL_DIALOGUES.length);
    }
    assert.equal(seen.size, goal === "everyday" && (level === "A0" || level === "A1") ? 12 : 2);
  }
});
