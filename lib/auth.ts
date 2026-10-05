import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import { pool } from "./db";

export const MCP_RESOURCE = `${process.env.BETTER_AUTH_URL}/mcp`;

export const auth = betterAuth({
  database: pool,
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10 },
  // Google sign-in creates an account on first use; every row is scoped by user id.
  // Password sign-up stays off: only an account made by `npm run create-owner` can use it.
  socialProviders: process.env.GOOGLE_CLIENT_ID
    ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET! } }
    : {},
  // Session-to-JWT endpoint isn't used; OAuth access tokens come from mcp().
  disabledPaths: ["/token"],
  plugins: [
    jwt(),
    // OAuth 2.1 server for the assistant: tokens are bound to MCP_RESOURCE (aud).
    // ChatGPT registers itself (dynamic client registration) and each user approves on /oauth/consent.
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
