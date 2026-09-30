// Creates the single owner account (signup is disabled in the app), or resets its password.
// Usage: npm run create-owner   (email = ALLOWED_EMAIL; the password is typed twice, without echo)
import { betterAuth } from "better-auth";
import { text } from "node:stream/consumers";
import pg from "pg";

let piped: string[] | undefined; // non-interactive input, read once
const email = process.env.ALLOWED_EMAIL;
if (!email || !process.env.DATABASE_URL) throw new Error("Set ALLOWED_EMAIL and DATABASE_URL");

// Asking twice also stops an accidental multi-line paste from becoming the password.
const password = await askPassword(`Password for ${email} (10+ characters): `);
if (password !== (await askPassword("Repeat password: "))) throw new Error("Passwords do not match");
if (password.length < 10) throw new Error("Password must be at least 10 characters");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ctx = await betterAuth({ database: pool, emailAndPassword: { enabled: true } }).$context;
const hash = await ctx.password.hash(password);
const existing = await ctx.internalAdapter.findUserByEmail(email);
if (existing) {
  await ctx.internalAdapter.updatePassword(existing.user.id, hash);
  console.log("Owner password updated:", email);
} else {
  const user = await ctx.internalAdapter.createUser({ email, name: email, emailVerified: true }, { method: "admin" });
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash });
  console.log("Owner created:", email);
}
await pool.end();
process.exit(0);

// Reads one line with echo off. The rest of a pasted chunk is discarded, not left for the shell.
async function askPassword(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  if (!process.stdin.isTTY) {
    piped ??= (await text(process.stdin)).split(/\r?\n/);
    return piped.shift() ?? "";
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      for (const ch of String(chunk)) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.off("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") process.exit(1); // Ctrl+C
        value = ch === "\u007f" ? value.slice(0, -1) : value + ch;
      }
    };
    process.stdin.on("data", onData);
  });
}
