# English Coach

English · [עברית](README.he.md)

A personal English-learning app (Hebrew UI) that an AI assistant can use as its memory. ChatGPT connects over **MCP with OAuth 2.1**, reads what I need to review, runs a short practice conversation, and saves the scored results – which then show up in the app's dashboard.

Live: [english-coach-mcp.vercel.app](https://english-coach-mcp.vercel.app) (single-owner deployment – the login is mine). Multi-user sibling project: [PaceBeep](https://github.com/gadshushan3030/pacebeep).

Want the same auth + MCP setup for your own app? It's extracted as a clean template: **[MCP OAuth Starter](https://github.com/gadshushan3030/mcp-oauth-starter)**.

## What it does

- **Flashcards** (English → Hebrew) with spaced repetition: "I know" moves a word up a box (review in 1/3/7/14/30/60 days), "Need practice" resets it.
- **Daily conversation**: one short scripted dialogue a day, with translation and speech (browser `speechSynthesis`).
- **Assistant practice over MCP**: ChatGPT opens a session, talks with me, then stores the sentences practiced, corrections, new words, a fixed 1–5 rubric (comprehension, vocabulary, grammar, pronunciation only for voice) and every exercise it checked.
- **Progress dashboard**: every session and exercise, self-assessment vs. checked answers side by side, connected assistants with a disconnect button.

![The practice loop: read progress, open a session, converse, save results, see them, review](docs/practice-loop.svg)

![Spaced repetition: seven boxes from due now to 60 days](docs/spaced-repetition.svg)

## Architecture

![Architecture: the owner on iPhone or Mac and ChatGPT, two doors into one Next.js app over Postgres](docs/architecture.svg)

## Design decisions worth reading

- **Tokens bound to the MCP server.** The Better Auth `mcp()` plugin issues JWT access tokens whose `aud` is `<BETTER_AUTH_URL>/mcp`, verified via JWKS (`requireMcpAuth`). A normal website session can't call `/mcp`.
- **Disconnect takes effect immediately.** JWTs stay valid until they expire, so `/mcp` also requires the owner's consent row on every request. Disconnect deletes the OAuth client, which cascades to the consent and refresh tokens. (Deleting only the consent does *not* revoke refresh tokens – found by testing.)
- **Single owner, two locks.** Signup is disabled (the owner is created by `npm run create-owner`), and a `session.create.before` hook refuses any account other than `ALLOWED_EMAIL`.
- **Idempotent writes.** Every MCP write takes a `request_id` with `unique (user_id, request_id)`; replays return the original row and don't move the spaced-repetition schedule twice. Batched exercises use `clock_timestamp()` so they keep their order.
- **Evidence kept apart.** Self-assessment ("I know it") lives in `reviews`; answers the assistant actually checked live in `exercises` (question, answer, result, attempt). The dashboard shows both, so "I know it" can be compared with reality.
- **No secrets in the repo.** Vercel env vars are Sensitive (not even `vercel env pull` can read them), so migrations run inside the Vercel build.

### How ChatGPT connects

![Sequence: discover, register, authorize with PKCE, token, tool calls](docs/oauth-flow.svg)

### How it got here

1. First version on Supabase, using its OAuth 2.1 server.
2. Supabase's free plan allows two active projects and both were taken, so I evaluated alternatives: MongoDB would replace only the database, not auth + OAuth.
3. Before rewriting, a spike: Better Auth's MCP plugin behind a temporary tunnel, connected to the real ChatGPT (DCR, PKCE, `iss` in the callback, stable redirect URI) – it worked.
4. Rewrite to Neon + Better Auth, then an end-to-end check: a real practice conversation in ChatGPT, saved and visible in the dashboard.

## MCP tools

| Tool | Purpose |
|---|---|
| `get_progress` | Word counts, self-marks vs. checked answers, words due, recent sessions |
| `start_practice` | Open a session → `practice_id` |
| `save_practice_results` | Sentences, corrections, new words, rubric scores, feedback, checked exercises |
| `record_exercises` | Checked answers outside a session |
| `add_words` / `set_word_familiarity` | Grow the deck, set familiarity 0–6 (reschedules review) |
| `get_practice` / `get_exercises` | Read back by id to confirm what was stored |

## Run locally

Requires Node 22+ and Docker.

```bash
npm install
npm run db:up
cp .env.example .env.local   # fill BETTER_AUTH_SECRET (openssl rand -hex 32) and ALLOWED_EMAIL
npm run db:migrate
npm run create-owner         # asks for the password twice, without echo
npm run dev
```

## Deploy (Vercel + Neon)

1. Import the repo in Vercel; **Storage → Neon** (Free), connected with env prefix `DATABASE`.
2. Env vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (production URL), `ALLOWED_EMAIL`.
3. Deploy – `vercel-build` applies `db/migrations/*.sql` first.
4. Create the owner against the production DB with `scripts/create-owner.mts`.

Then in ChatGPT: Settings → Security and login → Developer mode, add `https://<your-app>/mcp` as a plugin with OAuth, sign in, approve.

## Built with

Next.js 16, TypeScript, Tailwind, Better Auth (+ `@better-auth/mcp`), MCP TypeScript SDK v2, Postgres (Neon), Vercel.
Built together with an AI pair programmer (Claude Code); the commits are co-authored.

## License

MIT – see [LICENSE](LICENSE).
