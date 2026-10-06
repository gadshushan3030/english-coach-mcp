import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { completionFor, normalizeReviewAnswer } from "../lib/learning-loop";

// Isolated Postgres-compatible database; never connects to DATABASE_URL.
let db: PGlite;
let sequence = 0;
async function one<T = Record<string, unknown>>(query: string, values: unknown[] = []) {
  return (await db.query<T>(query, values)).rows[0];
}
async function id(query: string, values: unknown[] = []) {
  return (await one<{ id: string }>(query, values)).id;
}
async function queue(user: string, request = "question") {
  return id("select queue_practice_question($1,$2,'What did you do yesterday?',$3::jsonb,1,'בזמן עבר משתמשים ב־went.','I go to work yesterday.') as id", [user, request,
    JSON.stringify(["I go to work yesterday.", "I went to work yesterday.", "I going to work yesterday."]),
  ]);
}
async function skill(question: string) {
  return one<{ id: string; revision: number; stage: string; due_at: string; streak: number; review_count: number; variant_position: number }>("select * from practice_skills where question_id=$1", [question]);
}
async function fixture(correct = false) {
  const user = `learner-${++sequence}`, other = `${user}-other`;
  for (const uid of [user, other]) await db.query('insert into "user" (id,name,email,"emailVerified") values ($1,$1,$2,true)', [uid, `${uid}@example.test`]);
  const question = await queue(user);
  await id("select answer_practice_question($1,$2,$3) as id", [user, question, correct ? 1 : 0]);
  return { user, other, question, review: await skill(question) };
}
async function review(user: string, reviewId: string, revision: number, selected: number | null, answer: string | null, request = randomUUID()) {
  return id("select answer_practice_review($1,$2,$3,$4,$5,$6) as id", [user, reviewId, request, revision, selected, answer]);
}

before(async () => {
  db = new PGlite();
  for (const file of ["0001_auth.sql", "0002_app.sql", "0003_practice_questions.sql"]) await db.exec(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
  await db.exec('insert into "user" (id,name,email,"emailVerified") values (\'history\',\'History\',\'history@example.test\',true)');
  const question = await queue("history");
  await id("select answer_practice_question('history',$1,0) as id", [question]);
  await db.exec(await readFile(new URL("../db/migrations/0004_learning_loop.sql", import.meta.url), "utf8"));
});
after(async () => { await db?.close(); });

test("migration seeds historical mistakes and answering creates one scheduled skill", async () => {
  assert.equal((await one<{ count: number }>("select count(*)::int as count from practice_skills where user_id='history'")).count, 1);
  const { user, question, review: s } = await fixture();
  assert.equal(s.stage, "recognition");
  await db.query("select sync_practice_reviews($1)", [user]);
  assert.equal((await one<{ count: number }>("select count(*)::int as count from practice_skills where question_id=$1", [question])).count, 1);
  const right = await fixture(true);
  assert.equal(right.review.stage, "completion");
  const diff = +new Date(right.review.due_at) - +new Date(s.due_at);
  assert.ok(diff > 23 * 60 * 60 * 1000 && diff < 24 * 60 * 60 * 1000);
});

test("canonical review progression creates distinct checked evidence and retains the first answer", async () => {
  const { user, question, review: s } = await fixture();
  const first = await one("select * from practice_questions where id=$1", [question]);
  const recognition = await review(user, s.id, 0, 1, null);
  assert.deepEqual(await one("select result,response_format,answer,expected,question_id from exercises where id=$1", [recognition]), {
    result: "correct", response_format: "multiple_choice", answer: "I went to work yesterday.", expected: "I went to work yesterday.", question_id: null,
  });
  assert.equal((await skill(question)).stage, "completion");
  const completion = await review(user, s.id, 1, null, "WENT!");
  assert.deepEqual(await one("select result,response_format,expected,question from exercises where id=$1", [completion]), { result: "correct", response_format: "gap_completion", expected: "went", question: "I _____ to work yesterday." });
  assert.equal((await skill(question)).stage, "rewrite");
  const rewrite = await review(user, s.id, 2, null, "i went to work yesterday");
  assert.equal((await one<{ result: string }>("select result from exercises where id=$1", [rewrite])).result, "correct");
  assert.equal((await one<{ question: string }>("select question from exercises where id=$1", [rewrite])).question, "I go to work yesterday.");
  assert.equal((await skill(question)).review_count, 3);
  assert.deepEqual(await one("select * from practice_questions where id=$1", [question]), first);
  await assert.rejects(db.query("update exercises set result='incorrect' where id=$1", [rewrite]), /immutable/);
  await assert.rejects(db.query("update practice_skill_attempts set next_stage='recognition' where exercise_id=$1", [rewrite]), /immutable/);
});

test("uncertain and conflicting retries return the original attempt without rescheduling", async () => {
  const { user, question, review: s } = await fixture();
  const request = randomUUID();
  const exercise = await review(user, s.id, 0, 0, null, request);
  const saved = await skill(question);
  assert.equal(await review(user, s.id, 0, 1, null, request), exercise);
  assert.equal(await review(user, s.id, 50, null, "changed", request), exercise);
  assert.deepEqual(await skill(question), saved);
  assert.equal((await one<{ result: string }>("select result from exercises where id=$1", [exercise])).result, "incorrect");
  await assert.rejects(review(user, s.id, 0, 1, null), /changed/);
  assert.equal((await one<{ count: number }>("select count(*)::int as count from practice_skill_attempts where review_id=$1", [s.id])).count, 1);
});

test("wrong typed production uses the canonical key, returns to scaffolding, and is due sooner", async () => {
  const { user, question, review: s } = await fixture(true);
  await review(user, s.id, 0, null, "went");
  const beforeState = await skill(question);
  const exercise = await review(user, s.id, 1, null, "I go to work yesterday.");
  assert.equal((await one<{ result: string }>("select result from exercises where id=$1", [exercise])).result, "incorrect");
  const failed = await skill(question);
  assert.equal(failed.stage, "completion");
  assert.equal(failed.streak, 0);
  assert.ok(+new Date(failed.due_at) < +new Date(beforeState.due_at));
});

test("review isolation, invalid forms and reserved request collisions cannot create evidence", async () => {
  const { user, other, question, review: s } = await fixture();
  await assert.rejects(review(other, s.id, 0, 1, null), /not found/);
  for (const [choice, answer] of [[null, null], [3, null], [1, "answer"], [null, "invented"]] as const) await assert.rejects(review(user, s.id, 0, choice, answer));
  const request = randomUUID();
  await id("select record_exercise($1,$2,'Unrelated','Invented','correct') as id", [user, `review:${request}`]);
  await assert.rejects(review(user, s.id, 0, 1, null, request), /already used/);
  assert.equal((await skill(question)).revision, 0);
  assert.equal((await one<{ count: number }>("select count(*)::int as count from practice_skill_attempts where review_id=$1", [s.id])).count, 0);
  await assert.rejects(db.query("update practice_skills set user_id=$1 where id=$2", [other, s.id]));
});

test("review write, attempt and schedule roll back together", async () => {
  const { user, question, review: s } = await fixture();
  await db.exec("begin");
  const exercise = await review(user, s.id, 0, 1, null);
  assert.equal((await skill(question)).revision, 1);
  await db.exec("rollback");
  assert.deepEqual(await skill(question), s);
  assert.equal((await db.query("select id from exercises where id=$1", [exercise])).rows.length, 0);
});

test("variants retain their first payload, isolate ownership and rotate after a successful rewrite", async () => {
  const { user, other, question, review: s } = await fixture(true);
  const variants = [{ question: "Where did she go?", choices: ["She go home.", "She went home.", "She going home."], correct_index: 1, explanation_he: "זהו זמן עבר.", original: "She go home." }];
  await db.query("select queue_review_variants($1,$2,$3::jsonb)", [user, question, JSON.stringify(variants)]);
  await db.query("select queue_review_variants($1,$2,$3::jsonb)", [user, question, JSON.stringify([{ ...variants[0], question: "Changed" }])]);
  assert.equal((await one<{ question: string }>("select question from practice_question_variants where question_id=$1", [question])).question, variants[0].question);
  await assert.rejects(db.query("select queue_review_variants($1,$2,$3::jsonb)", [other, question, JSON.stringify(variants)]), /not found/);
  await review(user, s.id, 0, null, "went");
  await review(user, s.id, 1, null, "I went to work yesterday.");
  assert.equal((await skill(question)).variant_position, 1);
  assert.equal((await skill(question)).stage, "recognition", "a new contextual sentence is taught before independent correction");
  assert.equal((await one<{ corrected_sentence: string }>("select corrected_sentence from practice_review_content where id=$1", [s.id])).corrected_sentence, "She went home.");
  await assert.rejects(db.query("update practice_question_variants set question='Changed' where question_id=$1", [question]), /immutable/);
});

test("direct SQL cannot attach forged expected wording or a fabricated checked grade", async () => {
  const { user, other, review: s } = await fixture();
  const request = randomUUID();
  const exercise = await id("select record_exercise($1,$2,'What did you do yesterday?','I go to work yesterday.','correct','Invented',1,null,null,'app','multiple_choice') as id", [user, `review:${request}`]);
  await assert.rejects(db.query(`insert into practice_skill_attempts
    (user_id,request_id,review_id,exercise_id,revision,stage,variant_position,selected_index,corrected_sentence,explanation_he,next_due_at,next_stage)
    values ($1,$2,$3,$4,0,'recognition',0,0,'I went to work yesterday.','בזמן עבר משתמשים ב־went.',now()+interval '1 day','completion')`,
  [user, request, s.id, exercise]), /canonical/);
  await assert.rejects(db.query(`insert into practice_skill_attempts
    (user_id,request_id,review_id,exercise_id,revision,stage,variant_position,selected_index,corrected_sentence,explanation_he,next_due_at,next_stage)
    values ($1,$2,$3,$4,0,'recognition',0,0,'I went to work yesterday.','בזמן עבר משתמשים ב־went.',now()+interval '1 day','completion')`,
  [other, randomUUID(), s.id, exercise]), /not found/);
});

test("SQL and pure grading/completion contracts agree", async () => {
  for (const text of [" I'm READY! ", " I’m ready. ", "I go to work yesterday.", "Hi?", "Hello, world!"]) {
    assert.equal((await one<{ normalized: string }>("select normalize_review_answer($1) as normalized", [text])).normalized, normalizeReviewAnswer(text));
  }
  assert.deepEqual(await one("select * from review_completion('I went home.','I go home.')"), completionFor("I went home.", "I go home."));
});

test("maximum-length canonical sentences still generate and save a complete gap prompt", async () => {
  const { user } = await fixture();
  const sentence = `I ${"x".repeat(498)}`;
  const question = await id("select queue_practice_question($1,'max-review','Complete the sentence',$2::jsonb,0,'הסבר','Me') as id", [user, JSON.stringify([sentence, "Incorrect option", "Another incorrect option"])]);
  await id("select answer_practice_question($1,$2,0) as id", [user, question]);
  const s = await skill(question);
  const exercise = await review(user, s.id, 0, null, "I");
  const result = await one<{ result: string; question: string }>("select result,question from exercises where id=$1", [exercise]);
  assert.equal(result.result, "correct");
  assert.equal(result.question.length, 504);
});
