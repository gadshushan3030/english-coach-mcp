import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { PGlite } from "@electric-sql/pglite";
import { ADAPTIVE_DIALOGUES } from "../lib/adaptive-content";
import { persistConversation } from "../lib/conversation-store";

// Real SQL functions in an isolated in-memory database. No production connection.
let db: PGlite;
let sequence = 0;
const dialogue = ADAPTIVE_DIALOGUES[0];
const correct = dialogue.turns.map((turn) => turn.answer);
const incorrect = dialogue.turns.map((turn) => (turn.answer + 1) % turn.options.length);
const query = async (text: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(text, params)).rows;
const save = (userId: string, requestId: string, picks: number[]) => persistConversation(userId, userId, requestId, dialogue.id, picks, query);

before(async () => {
  db = new PGlite();
  for (const file of ["0001_auth.sql", "0002_app.sql", "0003_practice_questions.sql", "0004_learning_loop.sql", "0005_word_management.sql", "0006_learner_profile.sql", "0007_active_words.sql"]) {
    await db.exec(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
  }
});
after(async () => { await db?.close(); });
async function fixture() {
  const user = `conversation-${++sequence}`, other = `${user}-other`;
  for (const uid of [user, other]) await query('insert into "user" (id,name,email,"emailVerified") values ($1,$1,$2,true)', [uid, `${uid}@example.invalid`]);
  return { user, other };
}

test("a stale account identity rejects before any persistence SQL", async () => {
  let calls = 0;
  const forbiddenQuery = async () => { calls++; throw new Error("Database must not be called"); };
  await assert.rejects(persistConversation("current-user", "previous-user", "account-switch", dialogue.id, correct, forbiddenQuery), /different signed-in user/);
  await assert.rejects(persistConversation("current-user", undefined as unknown as string, "missing-account", dialogue.id, correct, forbiddenQuery), /different signed-in user/);
  assert.equal(calls, 0);
});

test("the authenticated server action checks stale identity before delegating to SQL or persistence", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const bundle = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "ts", contents: `
      import {saveConversation} from "./app/actions";
      globalThis.calls = {sql:0,persist:0,revalidate:[]};
      (async () => {
        let rejected = false;
        try { await saveConversation("action-switch", "${dialogue.id}", ${JSON.stringify(correct)}, "previous-user"); } catch { rejected = true; }
        const afterRejected = structuredClone(globalThis.calls);
        const result = await saveConversation("action-current", "${dialogue.id}", ${JSON.stringify(correct)}, "current-user");
        process.stdout.write(JSON.stringify({rejected,afterRejected,result,calls:globalThis.calls}));
      })().catch(error => { console.error(error); process.exitCode = 1; });
    ` },
    bundle: true, write: false, platform: "node", format: "cjs",
    plugins: [{ name: "server-action-boundaries", setup(build) {
      const mocks: Record<string, string> = {
        "@/lib/session": 'export const requireUser = async () => "current-user";',
        "@/lib/conversation-store": `export const persistConversation = async () => { globalThis.calls.persist++; return {picks:${JSON.stringify(incorrect)},correct:0,total:${correct.length}}; };`,
        "@/lib/db": 'export const sql = async () => {globalThis.calls.sql++; throw new Error("No live SQL");};',
        "@/lib/auth": 'export const auth = {api:{}};',
        "@/lib/question-store": 'export const answerQuestion = async () => {throw new Error("Not used");};',
        "next/cache": 'export const revalidatePath = path => globalThis.calls.revalidate.push(path);',
        "next/headers": 'export const headers = () => {throw new Error("Not used");};',
        "next/navigation": 'export const redirect = () => {throw new Error("Not used");};',
      };
      build.onResolve({ filter: /^(?:@\/lib\/|next\/)/ }, ({ path }) => path in mocks ? { path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path], loader: "js", resolveDir: root }));
    } }],
  });
  const result = spawnSync(process.execPath, ["--input-type=commonjs"], { input: bundle.outputFiles[0].text, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.rejected, true);
  assert.deepEqual(output.afterRejected, { sql: 0, persist: 0, revalidate: [] });
  assert.deepEqual(output.result, { picks: incorrect, correct: 0, total: correct.length }, "Action returns the persisted result, not current picks");
  assert.deepEqual(output.calls, { sql: 0, persist: 1, revalidate: ["/progress", "/"] });
});

test("canonical first answers win over divergent retries and checked evidence is written once", async () => {
  const { user } = await fixture();
  const first = await save(user, "conflicting-replay", incorrect);
  const evidence = await query("select id,answer,result,expected,checked_by,response_format from exercises where user_id=$1 order by request_id", [user]);
  assert.deepEqual(first, { picks: incorrect, correct: 0, total: correct.length });
  assert.deepEqual(await save(user, "conflicting-replay", correct), first);
  assert.deepEqual(await query("select id,answer,result,expected,checked_by,response_format from exercises where user_id=$1 order by request_id", [user]), evidence);
  assert.equal(evidence.length, correct.length);
  assert.ok(evidence.every((row) => row.checked_by === "app" && row.response_format === "multiple_choice" && row.result === "incorrect"));
  assert.equal((await query("select count(*)::int as count from practice_sessions where user_id=$1", [user]))[0].count, 1);
});

test("the same request id belongs independently to each authenticated user", async () => {
  const { user, other } = await fixture();
  assert.deepEqual(await save(user, "shared-request-id", incorrect), { picks: incorrect, correct: 0, total: correct.length });
  assert.deepEqual(await save(other, "shared-request-id", correct), { picks: correct, correct: correct.length, total: correct.length });
  const sessions = await query("select id,user_id from practice_sessions where user_id=any($1::text[])", [[user, other]]);
  assert.equal(sessions.length, 2);
  assert.notEqual(sessions[0].id, sessions[1].id);
  assert.equal((await query("select count(*)::int as count from exercises where user_id=$1", [user]))[0].count, correct.length);
  assert.equal((await query("select count(*)::int as count from exercises where user_id=$1", [other]))[0].count, correct.length);
});

test("different-dialogue replay is rejected before rewriting the saved conversation", async () => {
  const { user } = await fixture();
  await save(user, "dialogue-collision", incorrect);
  const previous = await query("select * from practice_sessions where user_id=$1", [user]);
  const otherDialogue = ADAPTIVE_DIALOGUES[1];
  await assert.rejects(persistConversation(user, user, "dialogue-collision", otherDialogue.id, otherDialogue.turns.map((turn) => turn.answer), query), /another dialogue/);
  assert.deepEqual(await query("select * from practice_sessions where user_id=$1", [user]), previous);
  assert.equal((await query("select count(*)::int as count from exercises where user_id=$1", [user]))[0].count, correct.length);
});

test("an unrelated exercise cannot be adopted through a reserved app request-id collision", async () => {
  const { user } = await fixture();
  const [session] = await query("select start_practice($1,'unrelated-session','Other topic','A1') as id", [user]);
  const turn = dialogue.turns[0];
  await query("select record_exercise($1,'app:exercise-collision:0',$2,$3,'correct',$3,p_session_id=>$4,p_checked_by=>'app',p_response_format=>'multiple_choice')", [user, turn.they, turn.options[turn.answer], session.id]);
  await assert.rejects(save(user, "exercise-collision", correct), /does not match/);
  assert.equal((await query("select count(*)::int as count from exercises where user_id=$1", [user]))[0].count, 1);
});

test("a lost confirmation after commit retries the original checked choices", async () => {
  const { user } = await fixture();
  let loseConfirmation = true;
  const unreliableQuery = async (text: string, params: unknown[] = []) => {
    if (loseConfirmation && text.includes("session_id=$2 and request_id=any")) {
      loseConfirmation = false;
      throw new Error("Confirmation lost after commit");
    }
    return query(text, params);
  };
  await assert.rejects(persistConversation(user, user, "uncertain-response", dialogue.id, incorrect, unreliableQuery), /Confirmation lost/);
  assert.deepEqual(await save(user, "uncertain-response", correct), { picks: incorrect, correct: 0, total: correct.length });
  assert.equal((await query("select count(*)::int as count from exercises where user_id=$1", [user]))[0].count, correct.length);
});

test("inconsistent saved canonical wording or result never produces a successful confirmation", async () => {
  const { user } = await fixture();
  await save(user, "inconsistent-answer", incorrect);
  await query("update exercises set result='correct' where user_id=$1 and request_id='app:inconsistent-answer:0'", [user]);
  await assert.rejects(save(user, "inconsistent-answer", correct), /does not match/);
});
