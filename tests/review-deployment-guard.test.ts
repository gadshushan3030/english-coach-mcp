import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("review-only branch disables auto deployment and refuses migration before DB access", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(config.git.deploymentEnabled, { "codex/conversation-practice-questions": false });
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/migrate.mts", import.meta.url))], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      VERCEL_GIT_COMMIT_REF: "codex/conversation-practice-questions",
      DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/never_connect",
      DATABASE_URL_UNPOOLED: "postgresql://synthetic:synthetic@127.0.0.1:1/never_connect",
    },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Migrations are disabled for the review-only/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|ETIMEDOUT|password authentication/);
});
