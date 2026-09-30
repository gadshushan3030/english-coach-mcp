import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import { pool } from "./db";

export const MCP_RESOURCE = `${process.env.BETTER_AUTH_URL}/mcp`;

export function isAllowedEmail(email: string | undefined | null) {
  const allowed = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  return !!allowed && email?.trim().toLowerCase() === allowed;
}

export const auth = betterAuth({
  database: pool,
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10 },
  // Session-to-JWT endpoint isn't used; OAuth access tokens come from mcp().
  disabledPaths: ["/token"],
  databaseHooks: {
    session: {
      create: {
        // Second lock next to disabled signup: nobody but ALLOWED_EMAIL ever gets a session.
        before: async (session) => {
          const { rows } = await pool.query('select email from "user" where id = $1', [session.userId]);
          if (!isAllowedEmail(rows[0]?.email)) throw new APIError("FORBIDDEN", { message: "Not allowed" });
        },
      },
    },
  },
  plugins: [
    jwt(),
    // OAuth 2.1 server for the assistant: tokens are bound to MCP_RESOURCE (aud).
    // ChatGPT registers itself (dynamic client registration) and the owner approves on /oauth/consent.
    mcp({
      loginPage: "/login",
      consentPage: "/oauth/consent",
      resource: MCP_RESOURCE,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    }),
    nextCookies(),
  ],
});
