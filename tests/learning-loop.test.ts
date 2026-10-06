import assert from "node:assert/strict";
import { test } from "node:test";
import { completionFor, matchesExpected, nextReviewState, reviewAnswerInput } from "../lib/learning-loop";

test("typed grading ignores writing conventions and retains grammatical differences", () => {
  assert.ok(matchesExpected("  I   WENT to work yesterday!  ", "I went to work yesterday."));
  assert.ok(matchesExpected("I’m ready.", "I'm ready"));
  assert.equal(matchesExpected("I go to work yesterday", "I went to work yesterday"), false);
  assert.equal(matchesExpected("Yesterday I went to work", "I went to work yesterday"), false);
  assert.equal(matchesExpected("Im ready", "I'm ready"), false);
  assert.equal(matchesExpected("I am ready", "I'm ready"), false);
});

test("completion hides the changed word instead of displaying the original mistake", () => {
  assert.deepEqual(completionFor("I went to work yesterday.", "I go to work yesterday."), { prompt: "I _____ to work yesterday.", expected: "went" });
  assert.deepEqual(completionFor("Hello world", "Hello world"), { prompt: "Hello _____", expected: "world" });
});

test("successful reviews progress to production and failures return sooner", () => {
  assert.deepEqual(nextReviewState("recognition", true, 0), { stage: "completion", streak: 1, delayMinutes: 1440 });
  assert.deepEqual(nextReviewState("completion", true, 1), { stage: "rewrite", streak: 2, delayMinutes: 4320 });
  assert.deepEqual(nextReviewState("rewrite", false, 2), { stage: "completion", streak: 0, delayMinutes: 10 });
  assert.equal(nextReviewState("rewrite", true, 10).delayMinutes, 43200);
});

test("review input accepts exactly one answer form and a stable UUID request", () => {
  const base = { review_id: "10000000-0000-4000-8000-000000000001", request_id: "10000000-0000-4000-8000-000000000002", revision: 0 };
  assert.equal(reviewAnswerInput.parse({ ...base, selected_index: 1 }).selected_index, 1);
  assert.equal(reviewAnswerInput.parse({ ...base, answer: " went " }).answer, "went");
  for (const input of [base, { ...base, answer: "" }, { ...base, selected_index: 3 }, { ...base, selected_index: 1, answer: "went" }, { ...base, revision: -1 }, { ...base, request_id: "unstable" }]) {
    assert.equal(reviewAnswerInput.safeParse(input).success, false);
  }
});
