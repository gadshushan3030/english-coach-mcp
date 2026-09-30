// Creates the single owner account (signup is disabled in the app).
// Usage: npm run create-owner   (email = ALLOWED_EMAIL; the password is typed without echo)
import { betterAuth } from "better-auth";
import { createInterface } from "node:readline";
import pg from "pg";

const email = process.env.ALLOWED_EMAIL;
if (!email || !process.env.DATABASE_URL) throw new Error("Set ALLOWED_EMAIL and DATABASE_URL");

const password = await askPassword(`Password for ${email} (10+ characters): `);
if (password.length < 10) throw new Error("Password must be at least 10 characters");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ctx = await betterAuth({ database: pool, emailAndPassword: { enabled: true } }).$context;
const user = await ctx.internalAdapter.createUser({ email, name: email, emailVerified: true }, { method: "admin" });
await ctx.internalAdapter.linkAccount({
  userId: user.id,
  providerId: "credential",
  accountId: user.id,
  password: await ctx.password.hash(password),
});
console.log("Owner created:", email);
await pool.end();
process.exit(0);

async function askPassword(prompt: string) {
  process.stdout.write(prompt);
  // Piped input (non-interactive): read one line.
  if (!process.stdin.isTTY) {
    for await (const line of createInterface({ input: process.stdin })) return line;
    return "";
  }
  process.stdin.setRawMode(true);
  let value = "";
  for await (const chunk of process.stdin) {
    for (const ch of String(chunk)) {
      if (ch === "\r" || ch === "\n") {
        process.stdin.setRawMode(false);
        process.stdout.write("\n");
        return value;
      }
      if (ch === "\u0003") process.exit(1); // Ctrl+C
      value = ch === "\u007f" ? value.slice(0, -1) : value + ch;
    }
  }
  return value;
}
