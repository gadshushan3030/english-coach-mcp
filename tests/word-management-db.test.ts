import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { archiveWordForUser, createWord, parseWordInput, recordWordReview, restoreWordForUser, updateWord } from "../lib/word-management";

// All persistence checks run in memory, never against DATABASE_URL.
let db: PGlite;
let sequence = 0;
const query = async (statement: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(statement, params)).rows;

before(async () => {
  db = new PGlite();
  for (const file of ["0001_auth.sql", "0002_app.sql", "0003_practice_questions.sql"]) {
    await db.exec(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.exec(`insert into "user" (id,name,email,"emailVerified") values ('word-history','History','word-history@example.test',true);
    insert into words (user_id,english,hebrew) values ('word-history','legacy','ישן');
    select review_word('word-history', (select id from words where user_id='word-history'), true);`);
  await db.exec(await readFile(new URL("../db/migrations/0005_word_management.sql", import.meta.url), "utf8"));
});
after(async () => { await db?.close(); });

async function fixture() {
  const user = `word-owner-${++sequence}`;
  const other = `${user}-other`;
  for (const owner of [user, other]) await query(`insert into "user" (id,name,email,"emailVerified") values ($1,$1,$2,true)`, [owner, `${owner}@example.test`]);
  const word = await createWord(user, { english: "remember", hebrew: "לזכור", example: "I remember you." }, query);
  const otherWord = await createWord(other, { english: "private", hebrew: "פרטי" }, query);
  return { user, other, word, otherWord };
}

async function schedule(wordId: string) {
  return (await query("select box, status, due_at, review_count, last_reviewed_at from words where id=$1", [wordId]))[0];
}

test("migration keeps historical self-assessments separate from checked answers", async () => {
  const [review] = await query("select knew, request_id from reviews where user_id='word-history'");
  assert.deepEqual(review, { knew: true, request_id: null });
  assert.equal((await query("select count(*)::int as count from exercises where user_id='word-history'"))[0].count, 0);
});

test("word edits trim and validate all fields before touching persistence", async () => {
  assert.deepEqual(parseWordInput({ english: " remember ", hebrew: " לזכור ", example: " \t " }), { english: "remember", hebrew: "לזכור", example: null });
  for (const input of [null, {}, { english: "", hebrew: "תרגום" }, { english: "word", hebrew: " \n" },
    { english: 42, hebrew: "תרגום" }, { english: "word", hebrew: "תרגום", example: 42 },
    { english: "a".repeat(101), hebrew: "תרגום" }, { english: "word", hebrew: "א".repeat(101) },
    { english: "word", hebrew: "תרגום", example: "a".repeat(301) }]) assert.throws(() => parseWordInput(input));
  const { user, word } = await fixture();
  const beforeState = await schedule(word);
  await assert.rejects(updateWord(user, word, { english: "word", hebrew: "" }, query));
  assert.deepEqual(await schedule(word), beforeState);
  await updateWord(user, word, { english: " recall ", hebrew: " להיזכר ", example: " I recall you. " }, query);
  assert.deepEqual((await query("select english,hebrew,example from words where id=$1", [word]))[0], { english: "recall", hebrew: "להיזכר", example: "I recall you." });
  assert.deepEqual(await schedule(word), beforeState);
});

test("edits, archive and restore are scoped to the signed-in owner", async () => {
  const { user, otherWord } = await fixture();
  const original = (await query("select * from words where id=$1", [otherWord]))[0];
  await assert.rejects(updateWord(user, otherWord, { english: "stolen", hebrew: "גנוב" }, query), /המילה לא נמצאה/);
  await assert.rejects(archiveWordForUser(user, otherWord, query), /word not found/);
  await assert.rejects(restoreWordForUser(user, otherWord, query), /word not found/);
  assert.deepEqual((await query("select * from words where id=$1", [otherWord]))[0], original);
});

test("archive and undo retain scheduling, self-assessments and checked evidence", async () => {
  const { user, word } = await fixture();
  const mark = await recordWordReview(user, word, true, "archive-review-01", query);
  await query("select record_exercise($1,'archive-exercise','Say remember','remember','correct',null,null,null,'remember')", [user]);
  const beforeState = await schedule(word);
  await archiveWordForUser(user, word, query);
  const [archived] = await query("select archived_at from words where id=$1", [word]);
  assert.ok(archived.archived_at);
  await archiveWordForUser(user, word, query);
  assert.deepEqual((await query("select archived_at from words where id=$1", [word]))[0], archived);
  assert.equal((await query("select id from words where user_id=$1 and archived_at is null", [user])).length, 0);
  await assert.rejects(recordWordReview(user, word, false, "archived-new-mark", query), /active word not found/);
  assert.deepEqual(await recordWordReview(user, word, false, "archive-review-01", query), mark);
  await restoreWordForUser(user, word, query);
  await restoreWordForUser(user, word, query);
  assert.equal((await query("select archived_at from words where id=$1", [word]))[0].archived_at, null);
  assert.deepEqual(await schedule(word), beforeState);
  assert.equal((await query("select count(*)::int as count from reviews where word_id=$1", [word]))[0].count, 1);
  assert.equal((await query("select count(*)::int as count from exercises where word_id=$1", [word]))[0].count, 1);
});

test("adding an archived word restores its identity and history; active duplicates are rejected", async () => {
  const { user, word } = await fixture();
  await recordWordReview(user, word, true, "restore-add-mark", query);
  const beforeState = await schedule(word);
  await assert.rejects(createWord(user, { english: "remember", hebrew: "לזכור" }, query), /כבר קיימת/);
  await archiveWordForUser(user, word, query);
  assert.equal(await createWord(user, { english: "remember", hebrew: "זכור", example: "Remember this." }, query), word);
  assert.deepEqual(await schedule(word), beforeState);
  assert.deepEqual((await query("select hebrew,example,archived_at from words where id=$1", [word]))[0], { hebrew: "זכור", example: "Remember this.", archived_at: null });
  const another = await createWord(user, { english: "another", hebrew: "אחר" }, query);
  await assert.rejects(updateWord(user, another, { english: "remember", hebrew: "זכור" }, query));
});

test("an add with a lost successful response confirms an identical replay without changing history", async () => {
  const { user, word } = await fixture();
  await recordWordReview(user, word, true, "lost-add-history", query);
  const beforeState = await schedule(word);
  assert.equal(await createWord(user, {
    english: " remember ", hebrew: " לזכור ", example: " I remember you. ",
  }, query), word);
  assert.deepEqual(await schedule(word), beforeState);
  assert.equal((await query("select count(*)::int as count from words where user_id=$1", [user]))[0].count, 1);
  assert.equal((await query("select count(*)::int as count from reviews where word_id=$1", [word]))[0].count, 1);
  await assert.rejects(createWord(user, { english: "remember", hebrew: "זכר", example: "I remember you." }, query), /כבר קיימת/);
  await assert.rejects(createWord(user, { english: "remember", hebrew: "לזכור", example: "Another example." }, query), /כבר קיימת/);
  assert.deepEqual((await query("select english,hebrew,example from words where id=$1", [word]))[0], {
    english: "remember", hebrew: "לזכור", example: "I remember you.",
  });
  const noExample = await createWord(user, { english: "brief", hebrew: "קצר", example: " " }, query);
  assert.equal(await createWord(user, { english: " brief ", hebrew: " קצר ", example: null }, query), noExample);
});

test("lost-response retries return the first mark and schedule exactly once", async () => {
  const { user, word } = await fixture();
  const first = await recordWordReview(user, word, true, "retry-review-001", query);
  const firstSchedule = await schedule(word);
  assert.equal(first.knew, true);
  assert.equal(first.wordId, word);
  assert.equal(firstSchedule.box, 1);
  assert.equal(firstSchedule.review_count, 1);
  assert.deepEqual(await recordWordReview(user, word, true, "retry-review-001", query), first);
  assert.deepEqual(await recordWordReview(user, word, false, "retry-review-001", query), first);
  assert.deepEqual(await schedule(word), firstSchedule);
  assert.equal((await query("select count(*)::int as count from reviews where word_id=$1", [word]))[0].count, 1);
  assert.equal((await query("select count(*)::int as count from exercises where word_id=$1", [word]))[0].count, 0);
  const second = await recordWordReview(user, word, false, "new-review-00002", query);
  assert.notEqual(second.id, first.id);
  assert.equal(second.knew, false);
  assert.equal((await schedule(word)).box, 0);
  assert.equal((await schedule(word)).status, "practice");
  assert.equal((await schedule(word)).review_count, 2);
});

test("review requests reject cross-owner access, cross-word collisions and malformed input", async () => {
  const { user, other, word, otherWord } = await fixture();
  const beforeState = await schedule(otherWord);
  await assert.rejects(recordWordReview(user, otherWord, true, "cross-owner-mark", query), /active word not found/);
  await recordWordReview(user, word, true, "shared-request-01", query);
  const another = await createWord(user, { english: "second", hebrew: "שני" }, query);
  const anotherBefore = await schedule(another);
  await assert.rejects(recordWordReview(user, another, true, "shared-request-01", query), /already used/);
  assert.deepEqual(await schedule(another), anotherBefore);
  assert.deepEqual(await schedule(otherWord), beforeState);
  await recordWordReview(other, otherWord, true, "shared-request-01", query);
  for (const request of ["", "short", "has spaces", "a".repeat(101)]) {
    await assert.rejects(query("select review_word_once($1,$2,true,$3)", [user, word, request]), /invalid/);
  }
  await assert.rejects(query("select review_word_once($1,$2,null,'null-input-mark')", [user, word]), /invalid/);
});

test("interrupted review transaction rolls back both evidence and schedule", async () => {
  const { user, word } = await fixture();
  const beforeState = await schedule(word);
  await db.exec("begin");
  await recordWordReview(user, word, true, "rolled-back-mark", query);
  assert.equal((await schedule(word)).box, 1);
  await db.exec("rollback");
  assert.deepEqual(await schedule(word), beforeState);
  assert.equal((await query("select count(*)::int as count from reviews where word_id=$1", [word]))[0].count, 0);
  const retried = await recordWordReview(user, word, false, "rolled-back-mark", query);
  assert.equal(retried.knew, false);
  assert.equal((await schedule(word)).review_count, 1);
});
