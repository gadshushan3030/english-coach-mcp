import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Deliberately in-memory: never read DATABASE_URL or connect to a live database.
let db: PGlite;
let sequence = 0;

async function id(sql: string, values: unknown[] = []) {
  const { rows } = await db.query<{ id: string }>(sql, values);
  return rows[0].id;
}

before(async () => {
  db = new PGlite();
  for (const file of ["0001_auth.sql", "0002_app.sql"]) {
    await db.exec(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.exec(`insert into "user" (id, name, email, "emailVerified") values ('history', 'History', 'history@example.test', true)`);
  await id("select record_exercise('history', 'legacy', 'Say hello', 'Hello', 'correct') as id");
  await db.exec(await readFile(new URL("../db/migrations/0003_practice_questions.sql", import.meta.url), "utf8"));
});

after(async () => { await db?.close(); });

async function fixture() {
  const user = `owner-${++sequence}`;
  const other = `${user}-other`;
  for (const uid of [user, other]) {
    await db.query(`insert into "user" (id, name, email, "emailVerified") values ($1, $1, $2, true)`, [uid, `${uid}@example.test`]);
  }
  const session = await id("select start_practice($1, 'session', 'Daily life', 'A1') as id", [user]);
  const otherSession = await id("select start_practice($1, 'session', 'Daily life', 'A1') as id", [other]);
  const word = await id("insert into words (user_id, english, hebrew, box) values ($1, 'yesterday', 'אתמול', 2) returning id", [user]);
  const otherWord = await id("insert into words (user_id, english, hebrew) values ($1, 'private', 'פרטי') returning id", [other]);
  return { user, other, session, otherSession, word, otherWord };
}

type QueueOverrides = {
  request?: string; question?: unknown; choices?: unknown; correct?: unknown;
  explanation?: unknown; original?: unknown; session?: string | null; word?: string | null;
};
async function queue(user: string, options: QueueOverrides = {}) {
  const data = {
    request: "question", question: "What did you do yesterday?",
    choices: ["I go to work yesterday.", "I went to work yesterday.", "I going to work yesterday."],
    correct: 1, explanation: "בזמן עבר משתמשים ב־went.", original: "I go to work yesterday.",
    session: null, word: null, ...options,
  };
  return id("select queue_practice_question($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) as id", [
    user, data.request, data.question, JSON.stringify(data.choices), data.correct,
    data.explanation, data.original, data.session, data.word,
  ]);
}
async function answer(user: string, question: string, selected: unknown) {
  return id("select answer_practice_question($1,$2,$3) as id", [user, question, selected]);
}
async function wordState(word: string) {
  return (await db.query("select box, due_at, review_count, last_reviewed_at from words where id=$1", [word])).rows[0];
}

test("historical exercises stay unspecified; explicit free-response and session formats persist", async () => {
  assert.equal((await db.query<{ response_format: string }>("select response_format from exercises where user_id='history'")).rows[0].response_format, "unspecified");
  const { user, session } = await fixture();
  await id("select record_exercise($1,'default','Q1','A','correct') as id", [user]);
  const explicit = await id("select record_exercise($1,'free','Q2','A','correct',p_response_format=>'free_response') as id", [user]);
  assert.equal(await id("select record_exercise($1,'free','changed','changed','incorrect',p_response_format=>'multiple_choice') as id", [user]), explicit);
  await id("select finish_practice($1,$2,p_exercises=>$3::jsonb) as id", [user, session, JSON.stringify([
    { request_id: "session-free", question: "Q3", answer: "A", result: "correct", response_format: "free_response" },
    { request_id: "session-mc", question: "Q4", answer: "A", result: "incorrect", response_format: "multiple_choice" },
    { request_id: "session-default", question: "Q5", answer: "A", result: "partial" },
  ])]);
  const { rows } = await db.query("select response_format, count(*)::int as count from exercises where user_id=$1 group by response_format order by response_format", [user]);
  assert.deepEqual(rows, [
    { response_format: "free_response", count: 2 },
    { response_format: "multiple_choice", count: 1 },
    { response_format: "unspecified", count: 2 },
  ]);
  await assert.rejects(id("select record_exercise($1,'bad-format','Q','A','correct',p_response_format=>'made-up') as id", [user]));
  const { rows: signatures } = await db.query("select pronargs from pg_proc where proname='record_exercise'");
  assert.deepEqual(signatures, [{ pronargs: 11 }]);
});

test("queue replay retains the first payload and request IDs are scoped to the user", async () => {
  const { user, other, session, word } = await fixture();
  const question = await queue(user, { session, word: "YESTERDAY" });
  const replay = await queue(user, { question: "Changed", correct: 0, choices: ["A", "B", "C"] });
  assert.equal(question, replay);
  assert.notEqual(await queue(other), question);
  const { rows } = await db.query("select question, correct_index, source_session_id, word_id, answered_at, exercise_id from practice_questions where id=$1", [question]);
  assert.deepEqual(rows[0], {
    question: "What did you do yesterday?", correct_index: 1,
    source_session_id: session, word_id: word, answered_at: null, exercise_id: null,
  });
  assert.equal((await db.query<{ count: number }>("select count(*)::int as count from exercises where user_id=$1", [user])).rows[0].count, 0);
});

test("choice shape, trim, uniqueness, lengths, indices and Hebrew explanation are enforced in SQL", async () => {
  const { user } = await fixture();
  const invalid: QueueOverrides[] = [
    { choices: null }, { choices: {} }, { choices: [] }, { choices: ["A", "B"] },
    { choices: ["A", "B", "C", "D"] }, { choices: ["A", "A", "C"] },
    { choices: ["A", "a", "C"] }, { choices: ["A", " B", "C"] },
    { choices: ["A", "B\t", "C"] }, { choices: ["A", "\u00a0B", "C"] },
    { choices: ["A", "", "C"] }, { choices: ["A", null, "C"] },
    { choices: ["A", 2, "C"] }, { choices: ["A", true, "C"] },
    { choices: ["A", {}, "C"] }, { choices: ["A", "B".repeat(501), "C"] },
    { correct: -1 }, { correct: 3 }, { correct: null },
    { question: null }, { question: "" }, { question: "\t" }, { question: "Q".repeat(501) },
    { explanation: null }, { explanation: "" }, { explanation: "   " },
    { explanation: "English only" }, { explanation: "א".repeat(501) },
    { original: "" }, { original: null }, { original: "O".repeat(501) },
    { request: "" }, { request: "R".repeat(101) },
  ];
  for (const [index, bad] of invalid.entries()) {
    await assert.rejects(queue(user, { request: `invalid-${index}`, ...bad }), `accepted malformed input ${JSON.stringify(bad)}`);
  }
  await assert.rejects(db.query(`insert into practice_questions (user_id,request_id,question,choices,correct_index,explanation_he,original)
    values ($1,'direct','Q','["A", "a", "C"]',1,'הסבר','Original')`, [user]));
  await queue(user, { request: "maximum", question: "Q".repeat(500), choices: ["A".repeat(500), "B".repeat(500), "C".repeat(500)], explanation: "א".repeat(500), original: "O".repeat(500) });
});

test("cross-user question, source-session and word access is rejected, including direct SQL", async () => {
  const { user, other, otherSession, otherWord } = await fixture();
  await assert.rejects(queue(user, { session: otherSession }), /practice session not found/);
  await assert.rejects(queue(user, { word: "private" }), /unknown word/);
  const question = await queue(user);
  await assert.rejects(answer(other, question, 1), /practice question not found/);
  for (const [column, value] of [["source_session_id", otherSession], ["word_id", otherWord]]) {
    await assert.rejects(db.query(`insert into practice_questions (user_id,request_id,question,choices,correct_index,explanation_he,original,${column})
      values ($1,$2,'Q','["A","B","C"]',1,'הסבר','Original',$3)`, [user, `foreign-${column}`, value]));
  }
  const exercise = await answer(user, question, 1);
  await assert.rejects(db.query("update exercises set user_id=$1 where id=$2", [other, exercise]));
  await assert.rejects(db.query("update practice_questions set user_id=$1 where id=$2", [other, question]));
});

test("first answer derives canonical result, preserves source provenance, and schedules exactly once", async () => {
  const { user, session, word } = await fixture();
  const question = await queue(user, { session, word: "yesterday" });
  const exercise = await answer(user, question, 1);
  const scheduled = await wordState(word);
  assert.equal((scheduled as { box: number }).box, 3);
  assert.equal(await answer(user, question, 1), exercise);
  assert.equal(await answer(user, question, 0), exercise);
  assert.deepEqual(await wordState(word), scheduled);
  const { rows } = await db.query(`select e.question_id, e.selected_index, e.answer, e.expected, e.result, e.response_format, e.session_id,
    e.word_id, e.attempt, e.checked_by, q.source_session_id, q.exercise_id, q.selected_index as saved_selection
    from exercises e join practice_questions q on q.id=e.question_id where e.id=$1`, [exercise]);
  assert.deepEqual(rows[0], {
    question_id: question, selected_index: 1, answer: "I went to work yesterday.", expected: "I went to work yesterday.",
    result: "correct", response_format: "multiple_choice", session_id: null, word_id: word,
    attempt: 1, checked_by: "app", source_session_id: session, exercise_id: exercise, saved_selection: 1,
  });
  assert.equal((await db.query<{ count: number }>("select count(*)::int as count from exercises where question_id=$1", [question])).rows[0].count, 1);
});

test("incorrect first answer cannot be changed by a subsequent correct answer", async () => {
  const { user, word } = await fixture();
  const question = await queue(user, { word: "yesterday" });
  const exercise = await answer(user, question, 0);
  const scheduled = await wordState(word);
  assert.equal((scheduled as { box: number }).box, 0);
  assert.equal(await answer(user, question, 1), exercise);
  assert.deepEqual(await wordState(word), scheduled);
  const { rows } = await db.query("select selected_index, result, answer, expected from exercises where id=$1", [exercise]);
  assert.deepEqual(rows[0], { selected_index: 0, result: "incorrect", answer: "I go to work yesterday.", expected: "I went to work yesterday." });
});

test("invalid indices do not create evidence or alter the word schedule", async () => {
  const { user, word } = await fixture();
  const question = await queue(user, { word: "yesterday" });
  const beforeState = await wordState(word);
  for (const selected of [-1, 3, null]) await assert.rejects(answer(user, question, selected), /selected_index/);
  assert.deepEqual(await wordState(word), beforeState);
  const { rows } = await db.query("select exercise_id, selected_index, answered_at from practice_questions where id=$1", [question]);
  assert.deepEqual(rows[0], { exercise_id: null, selected_index: null, answered_at: null });
});

test("transaction interruption rolls back question, exercise and scheduling together", async () => {
  const { user, word } = await fixture();
  const question = await queue(user, { word: "yesterday" });
  const beforeState = await wordState(word);
  await db.exec("begin");
  const rolledBackExercise = await answer(user, question, 1);
  assert.equal((await wordState(word) as { box: number }).box, 3);
  await db.exec("rollback");
  assert.deepEqual(await wordState(word), beforeState);
  assert.equal((await db.query("select id from exercises where id=$1", [rolledBackExercise])).rows.length, 0);
  assert.equal((await db.query<{ exercise_id: string | null }>("select exercise_id from practice_questions where id=$1", [question])).rows[0].exercise_id, null);
  const exercise = await answer(user, question, 0);
  assert.notEqual(exercise, rolledBackExercise);
  assert.equal((await wordState(word) as { box: number }).box, 0);
});

test("direct SQL cannot rewrite a queued question or its linked checked answer", async () => {
  const { user } = await fixture();
  const question = await queue(user);
  await assert.rejects(db.query("update practice_questions set choices='[\"X\",\"Y\",\"Z\"]' where id=$1", [question]), /immutable/);
  const exercise = await answer(user, question, 0);
  for (const assignment of ["answer='invented'", "result='correct'", "selected_index=1", "response_format='free_response'", "question_id=null"]) {
    await assert.rejects(db.query(`update exercises set ${assignment} where id=$1`, [exercise]), /immutable/);
  }
  await assert.rejects(db.query("update practice_questions set selected_index=1 where id=$1", [question]), /immutable/);
  await assert.rejects(db.query("update practice_questions set exercise_id=null, selected_index=null, answered_at=null where id=$1", [question]), /immutable/);
});

test("an unrelated exercise cannot be adopted through a deterministic request-id collision", async () => {
  const { user, word } = await fixture();
  const question = await queue(user, { word: "yesterday" });
  await id("select record_exercise($1,$2,'Forged','Forged','correct') as id", [user, `practice_question:${question}`]);
  const beforeState = await wordState(word);
  await assert.rejects(answer(user, question, 1), /request id already used/);
  assert.deepEqual(await wordState(word), beforeState);
  assert.equal((await db.query<{ exercise_id: string | null }>("select exercise_id from practice_questions where id=$1", [question])).rows[0].exercise_id, null);
});

test("deleting optional source/word records keeps the authoritative recognition evidence", async () => {
  const { user, session, word } = await fixture();
  const question = await queue(user, { session, word: "yesterday" });
  const exercise = await answer(user, question, 1);
  await db.query("delete from practice_sessions where id=$1", [session]);
  await db.query("delete from words where id=$1", [word]);
  assert.equal(await answer(user, question, 0), exercise);
  const { rows } = await db.query("select source_session_id, word_id, exercise_id from practice_questions where id=$1", [question]);
  assert.deepEqual(rows[0], { source_session_id: null, word_id: null, exercise_id: exercise });
  await db.query('delete from "user" where id=$1', [user]);
  assert.equal((await db.query("select id from practice_questions where id=$1", [question])).rows.length, 0);
});

test("adding a case-variant word after queueing cannot redirect the linked word schedule", async () => {
  const { user, word } = await fixture();
  const question = await queue(user, { word: "yesterday" });
  const variant = await id("insert into words (id,user_id,english,hebrew) values ('00000000-0000-0000-0000-000000000001',$1,'Yesterday','אתמול') returning id", [user]);
  const variantBefore = await wordState(variant);
  await answer(user, question, 1);
  assert.equal((await wordState(word) as { box: number }).box, 3);
  assert.deepEqual(await wordState(variant), variantBefore);
  const upperQuestion = await queue(user, { request: "upper", word: "Yesterday" });
  await answer(user, upperQuestion, 1);
  assert.equal((await wordState(variant) as { box: number }).box, 1);
  assert.equal((await wordState(word) as { box: number }).box, 3);
});

test("direct SQL cannot attach forged canonical metadata or a different user's question", async () => {
  const { user, other, session, otherWord } = await fixture();
  const question = await queue(user);
  const foreignQuestion = await queue(other);
  const canonical = {
    user, request: `practice_question:${question}`, question: "What did you do yesterday?",
    answer: "I went to work yesterday.", expected: "I went to work yesterday.", result: "correct",
    format: "multiple_choice", questionId: question, selected: 1, session: null, word: null,
    checked: "app", attempt: 1,
  };
  const invalid = [
    { expected: null }, { expected: "Invented" }, { question: "Invented" }, { answer: "Invented" },
    { result: "incorrect" }, { selected: 0 }, { selected: 3 }, { format: "free_response" },
    { questionId: foreignQuestion }, { session }, { word: otherWord },
    { checked: "assistant" }, { attempt: 2 }, { request: "arbitrary" },
  ];
  for (const bad of invalid) {
    const d = { ...canonical, ...bad };
    await assert.rejects(db.query(`insert into exercises
      (user_id,request_id,question,answer,expected,result,response_format,question_id,selected_index,session_id,word_id,checked_by,attempt)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
      d.user, d.request, d.question, d.answer, d.expected, d.result, d.format, d.questionId,
      d.selected, d.session, d.word, d.checked, d.attempt,
    ]), `accepted forged canonical metadata ${JSON.stringify(bad)}`);
  }
  const unrelated = await id("select record_exercise($1,'unrelated','Q','A','correct') as id", [user]);
  await assert.rejects(db.query("update practice_questions set exercise_id=$1, selected_index=1, answered_at=now() where id=$2", [unrelated, question]), /canonical exercise/);
});
