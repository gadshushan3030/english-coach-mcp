// Applies db/migrations/*.sql in name order, each once, each in a transaction.
// Usage: npm run db:migrate. Also runs on every Vercel build (vercel-build), where the
// Neon variables exist; the direct (unpooled) connection is preferred for DDL.
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

// Defense in depth for the review-only PR: never open a database connection if
// Vercel attempts to build this branch despite its no-auto-deployment config.
if (process.env.VERCEL_GIT_COMMIT_REF === "codex/conversation-practice-questions") {
  throw new Error("Migrations are disabled for the review-only conversation-practice-questions branch");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL });
// Stable application key. A session lock spans every per-file transaction and
// makes concurrent deployments read migration history only after the prior run.
const migrationLock = [0x45434d43, 1];
let locked = false;
try {
  await client.connect();
  await client.query("select pg_advisory_lock($1::integer, $2::integer)", migrationLock);
  locked = true;
  await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));

  const dir = new URL("../db/migrations/", import.meta.url);
  for (const name of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    await client.query("begin");
    try {
      await client.query(await readFile(new URL(name, dir), "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [name]);
      await client.query("commit");
      console.log("applied", name);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} finally {
  try {
    if (locked) await client.query("select pg_advisory_unlock($1::integer, $2::integer)", migrationLock);
  } finally {
    // Closing the session also releases the lock if explicit unlock failed.
    await client.end();
  }
}
