import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pool } from "../lib/db";
import { buildServer } from "../lib/mcp";
import { answerQuestion, listPendingQuestions } from "../lib/question-store";

type Transport = Parameters<ReturnType<typeof buildServer>["connect"]>[0];
type Message = Parameters<Transport["send"]>[0];
let db: PGlite;
const servers: ReturnType<typeof buildServer>[] = [];
before(async () => {
  db = new PGlite();
  for (const file of ["0001_auth.sql", "0002_app.sql", "0003_practice_questions.sql"]) {
    await db.exec(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.exec(`insert into "user" (id,name,email,"emailVerified") values
    ('one','One','one@example.invalid',true), ('two','Two','two@example.invalid',true)`);
  mock.method(pool, "query", async (query: string, params: unknown[] = []) => db.query(query, params));
});
after(async () => {
  for (const server of servers) await server.close();
  mock.restoreAll();
  await pool.end();
  await db.close();
});
async function client(user: string) {
  const server = buildServer(user);
  servers.push(server);
  let sequence = 0;
  const pending = new Map<number, (message: Message) => void>();
  const transport: Transport = {
    async start() {},
    async close() { transport.onclose?.(); },
    async send(message) {
      if ("id" in message && typeof message.id === "number") pending.get(message.id)?.(message);
    },
  };
  await server.connect(transport);
  async function request(method: string, params: Record<string, unknown>) {
    const id = ++sequence;
    const message = await new Promise<Message>((resolve) => {
      pending.set(id, resolve);
      transport.onmessage?.({ jsonrpc: "2.0", id, method, params });
    });
    pending.delete(id);
    if ("error" in message) throw new Error(JSON.stringify(message.error));
    assert("result" in message);
    return message.result as { isError?: boolean; content: { type: string; text: string }[]; tools?: { name: string }[] };
  }
  await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "isolated-test", version: "1" } });
  transport.onmessage?.({ jsonrpc: "2.0", method: "notifications/initialized" });
  return {
    request,
    async call(name: string, args: Record<string, unknown>) {
      return request("tools/call", { name, arguments: args });
    },
  };
}
const question = {
  request_id: "test-question-one", question: "Which sentence is correct?",
  original: "I want to listening podcast",
  choices: ["I want to listening podcast", "I want to listen to podcasts", "I want listen podcasts"],
  correct_index: 1, explanation_he: "אחרי want משתמשים ב־to ובפועל הבסיסי.",
};
test("MCP lists tools, validates inputs, queues per-user, hides keys, and preserves canonical retries", { timeout: 15000 }, async () => {
  const one = await client("one");
  const two = await client("two");
  const listed = await one.request("tools/list", {});
  assert(listed.tools?.some((tool) => tool.name === "queue_practice_question"));
  assert(listed.tools?.some((tool) => tool.name === "get_pending_questions"));
  const invalid = await one.call("queue_practice_question", { ...question, choices: ["a", "a", "c"] });
  assert.equal(invalid.isError, true);
  assert.deepEqual(await listPendingQuestions("one"), []);
  const queued = await one.call("queue_practice_question", question);
  assert.notEqual(queued.isError, true);
  const { question_id } = JSON.parse(queued.content[0].text);
  const replay = await one.call("queue_practice_question", { ...question, correct_index: 0 });
  assert.equal(JSON.parse(replay.content[0].text).question_id, question_id);
  const other = await two.call("get_pending_questions", {});
  assert.deepEqual(JSON.parse(other.content[0].text).questions, []);
  const own = await one.call("get_pending_questions", {});
  const [pending] = JSON.parse(own.content[0].text).questions;
  assert.equal(pending.id, question_id);
  for (const key of ["correct_index", "explanation_he", "exercise_id", "user_id"]) assert.equal(key in pending, false);
  await assert.rejects(answerQuestion("two", question_id, 1), /not found/);
  await assert.rejects(answerQuestion("one", question_id, 3));
  const answer = await answerQuestion("one", question_id, 0);
  assert.equal(answer.result, "incorrect");
  assert.equal(answer.answer, question.choices[0]);
  assert.equal(answer.expected, question.choices[1]);
  assert.equal(answer.explanation_he, question.explanation_he);
  assert.deepEqual(await answerQuestion("one", question_id, 1), answer);
  assert.deepEqual(await listPendingQuestions("one"), []);
  const read = await one.call("get_exercises", { exercise_ids: [answer.exercise_id] });
  assert.equal(JSON.parse(read.content[0].text)[0].response_format, "multiple_choice");
  const inaccessible = await two.call("get_exercises", { exercise_ids: [answer.exercise_id] });
  assert.deepEqual(JSON.parse(inaccessible.content[0].text), []);
});
