import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
let temporary: string;
let loaderPath: string;
const migrationSql = new Map<string, string>();
let migrationNames: string[];

before(async () => {
  const migrationDir = new URL("../db/migrations/", import.meta.url);
  migrationNames = (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrationNames) migrationSql.set(await readFile(new URL(name, migrationDir), "utf8"), name);
  temporary = await mkdtemp(`${tmpdir()}/english-coach-migration-test-`);
  loaderPath = `${temporary}/mock-pg-loader.mjs`;
  const mockModule = `
    async function send(kind, fields = {}) {
      const response = await fetch(process.env.MIGRATION_MOCK_URL, {
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({kind,client:String(process.pid),...fields})
      });
      const result = await response.json();
      if (result.error) throw new Error(result.error);
      return result;
    }
    class Client {
      async connect() { await send("connect"); }
      async query(text, values = []) { return send("query", {text,values}); }
      async end() { await send("end"); }
    }
    export default {Client};
  `;
  const mockUrl = `data:text/javascript,${encodeURIComponent(mockModule)}`;
  await writeFile(loaderPath, `
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === "pg") return {url:${JSON.stringify(mockUrl)},shortCircuit:true};
      return nextResolve(specifier, context);
    }
  `);
});
after(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

type Event = { kind: string; client: string; name?: string; count?: number; values?: unknown[] };
type Message = { kind: string; client: string; text?: string; values?: unknown[] };

// Shared synthetic pg transport: child processes execute the actual runner;
// transaction history and the blocking session lock live in this one backend.
async function backend(options: { failMigration?: string; waitForContender?: boolean; failUnlock?: boolean; failConnect?: boolean } = {}) {
  const events: Event[] = [];
  const done = new Set<string>();
  const transactions = new Map<string, { sqlName?: string; name?: string }>();
  let owner: string | null = null;
  let failedMigration = false, failedUnlock = false;
  const waiting: { client: string; response: ServerResponse }[] = [];
  let contender: (() => void) | undefined;
  const contenderSeen = new Promise<void>((resolve) => { contender = resolve; });
  const reply = (response: ServerResponse, value: unknown = { rows: [] }) => {
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value));
  };
  function release(client: string) {
    if (owner !== client) return;
    owner = null;
    const next = waiting.shift();
    if (next) {
      owner = next.client;
      events.push({ kind: "locked", client: next.client });
      reply(next.response);
    }
  }
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Message;
      const { client, text = "", values = [] } = message;
      if (message.kind === "connect") {
        events.push({ kind: "connect", client });
        if (options.failConnect) throw new Error("Synthetic connect failure");
      } else if (message.kind === "end") {
        events.push({ kind: "end", client }); release(client);
      } else if (text.startsWith("select pg_advisory_lock(")) {
        events.push({ kind: "lock-request", client, values });
        if (owner !== null) {
          events.push({ kind: "waiting", client }); waiting.push({ client, response }); contender?.(); return;
        }
        owner = client; events.push({ kind: "locked", client });
      } else if (text.startsWith("select pg_advisory_unlock(")) {
        events.push({ kind: "unlock", client, values });
        if (options.failUnlock && !failedUnlock) { failedUnlock = true; throw new Error("Synthetic unlock failure"); }
        release(client);
      } else {
        assert.equal(owner, client, "All schema creation/history/DDL must run while this session owns the lock");
        if (text.startsWith("create table if not exists schema_migrations")) events.push({ kind: "schema-history", client });
        else if (text === "select name from schema_migrations") {
          events.push({ kind: "read-history", client, count: done.size });
          reply(response, { rows: [...done].map((name) => ({ name })) }); return;
        } else if (text === "begin") transactions.set(client, {});
        else if (text === "rollback") {
          events.push({ kind: "rollback", client }); transactions.delete(client);
        } else if (text === "commit") {
          const transaction = transactions.get(client);
          assert(transaction?.name && transaction.name === transaction.sqlName);
          done.add(transaction.name); events.push({ kind: "commit", client, name: transaction.name }); transactions.delete(client);
        } else if (text.startsWith("insert into schema_migrations")) {
          const transaction = transactions.get(client);
          const name = String(values[0]);
          assert(transaction); assert.equal(done.has(name), false, "A migration must never be committed twice");
          transaction.name = name;
        } else {
          const name = migrationSql.get(text);
          assert(name, "Runner submits an actual checked-in migration");
          const transaction = transactions.get(client);
          assert(transaction); transaction.sqlName = name;
          events.push({ kind: "apply", client, name });
          if (options.waitForContender && name === migrationNames[0]) await contenderSeen;
          if (options.failMigration === name && !failedMigration) {
            failedMigration = true; throw new Error("Synthetic migration failure");
          }
        }
      }
      reply(response);
    })().catch((error: Error) => reply(response, { error: error.message }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  return {
    events, done, url: `http://127.0.0.1:${address.port}`,
    async close() {
      for (const waiter of waiting) reply(waiter.response, { error: "Synthetic backend closed" });
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function run(url: string, branch = "isolated-migration-test") {
  const child = spawn(process.execPath, ["--experimental-loader", loaderPath, `${root}/scripts/migrate.mts`], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: "postgresql://synthetic/no-live-database", DATABASE_URL_UNPOOLED: "", MIGRATION_MOCK_URL: url, VERCEL_GIT_COMMIT_REF: branch },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
  try {
    const status = await new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    return { status, stdout, stderr };
  } finally { clearTimeout(timer); }
}

test("concurrent runner processes serialize before reading history and apply each migration once", { timeout: 30000 }, async () => {
  const db = await backend({ waitForContender: true });
  try {
    const results = await Promise.all([run(db.url), run(db.url)]);
    for (const result of results) assert.equal(result.status, 0, result.stderr);
    assert.equal(db.events.filter((event) => event.kind === "waiting").length, 1, "The test exercises an actually blocked second process");
    assert.deepEqual(db.events.filter((event) => event.kind === "read-history").map((event) => event.count), [0, migrationNames.length]);
    assert.deepEqual(db.events.filter((event) => event.kind === "commit").map((event) => event.name), migrationNames);
    assert.equal(db.events.filter((event) => event.kind === "apply").length, migrationNames.length);
    assert.equal(db.events.filter((event) => event.kind === "end").length, 2);
    const keys = db.events.filter((event) => event.kind === "lock-request" || event.kind === "unlock").map((event) => JSON.stringify(event.values));
    assert.equal(new Set(keys).size, 1, "Both processes acquire and release the same stable lock key");
    assert.equal(db.done.size, migrationNames.length);
  } finally { await db.close(); }
});

test("failed migration rolls back and releases its session; a later runner resumes committed history", { timeout: 30000 }, async () => {
  const db = await backend({ failMigration: migrationNames[3] });
  try {
    const failed = await run(db.url);
    assert.notEqual(failed.status, 0); assert.match(failed.stderr, /Synthetic migration failure/);
    assert.deepEqual([...db.done], migrationNames.slice(0, 3));
    const cleanup = db.events.filter((event) => ["rollback", "unlock", "end"].includes(event.kind));
    assert.deepEqual(cleanup.map((event) => event.kind), ["rollback", "unlock", "end"]);
    const resumed = await run(db.url);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.deepEqual(db.events.filter((event) => event.kind === "commit").map((event) => event.name), migrationNames);
    assert.equal(db.done.size, migrationNames.length);
  } finally { await db.close(); }
});

test("an explicit unlock failure still closes the client and frees the lock for the next runner", { timeout: 30000 }, async () => {
  const db = await backend({ failUnlock: true });
  try {
    const failed = await run(db.url);
    assert.notEqual(failed.status, 0); assert.match(failed.stderr, /Synthetic unlock failure/);
    assert.equal(db.events.filter((event) => event.kind === "end").length, 1);
    const retry = await run(db.url);
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(db.events.filter((event) => event.kind === "apply").length, migrationNames.length);
  } finally { await db.close(); }
});

test("the protected review branch refuses to connect or acquire a lock", { timeout: 30000 }, async () => {
  const db = await backend();
  try {
    const result = await run(db.url, "codex/conversation-practice-questions");
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Migrations are disabled/);
    assert.deepEqual(db.events, []);
  } finally { await db.close(); }
});

test("a connection failure still closes the client without attempting lock release", { timeout: 30000 }, async () => {
  const db = await backend({ failConnect: true });
  try {
    const result = await run(db.url);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Synthetic connect failure/);
    assert.deepEqual(db.events.map((event) => event.kind), ["connect", "end"]);
  } finally { await db.close(); }
});
