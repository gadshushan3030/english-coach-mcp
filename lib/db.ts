import { Pool, types } from "pg";

// DATE columns stay "YYYY-MM-DD" strings instead of local-midnight Date objects.
types.setTypeParser(1082, (v) => v);

const g = globalThis as { pgPool?: Pool };
export const pool = (g.pgPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }));

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  return (await pool.query(text, params)).rows as T[];
}

// Israel local date (YYYY-MM-DD); the server runs in UTC on Vercel.
export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}
