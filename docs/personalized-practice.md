# Conversation-derived practice questions

## Review scope

The assistant writes questions through MCP; no additional AI service is needed. `/talk`
loads the authenticated learner's unanswered questions, while scripted daily dialogues
remain available. A question is three-choice recognition practice, not proof that the
learner can independently produce the sentence.

Apply migration `0003_practice_questions.sql` through the existing migration runner
only in an explicitly approved environment. It creates a question queue and adds
response-format metadata without relabeling historical exercises. This change has
not been deployed or applied to the production database.

## Assistant workflow

1. Open and finish the usual practice session with actual sentences/corrections.
2. Call `queue_practice_question` once per useful real error. Generate a stable
   `request_id` and reuse it on retry. Supply the source `practice_id` as
   `source_session_id` when available. Questions without a saved session can omit it.
3. Confirm with `get_pending_questions`. Pending questions have no exercise result,
   do not affect accuracy, and do not move word review dates.
4. The learner selects one of three choices in `/talk`. The authenticated server
   grades against the stored answer key, saves the actual choice, and returns a
   short Hebrew explanation. Answer keys are omitted from pending-question reads.
5. Progress labels the new answer as multiple-choice recognition and links to the
   source conversation when available. The original session and its scores stay
   unchanged. `get_exercises` exposes the stored `response_format`.

Example `queue_practice_question` input (the original must come from a real conversation):

```json
{
  "request_id": "6e67d6fa-e856-4b59-ac5e-8097db06c1cb",
  "question": "Which sentence is correct?",
  "original": "I want to listening podcast",
  "choices": [
    "I want to listening podcast",
    "I want to listen to podcasts",
    "I want listen podcasts"
  ],
  "correct_index": 1,
  "explanation_he": "אחרי want משתמשים ב־to ובפועל הבסיסי. אחרי listen מוסיפים to."
}
```

Choices must be distinct after trimming/case normalization; exactly three are
required, with one integer correct index from 0 to 2. The explanation must include
Hebrew and be no longer than 500 characters. The model remains responsible for
linguistic correctness and the quality of distractors; validation cannot prove
that a natural-language question has only one semantically valid answer.

## Retry and evidence semantics

- Queue IDs are scoped to the authenticated user. Reusing an ID preserves the
  original question rather than editing it.
- Answering is atomic. A row lock makes the first saved selection authoritative,
  including simultaneous clicks or retries with different selections. A lost
  response can be retried; the server returns the original persisted result.
- Each answer creates one checked exercise using a deterministic internal request
  ID. An optional linked deck word advances/resets once through the existing
  `record_exercise` logic. Queueing alone never reschedules a word.
- If saving fails, the UI retains the choice and offers retry. Reloading reads the
  remaining queue, so committed answers are not presented again. Uncommitted
  answers remain pending.
- Existing mixed-format history remains `unspecified`. New assistant-recorded
  exercises can explicitly use `free_response` or `multiple_choice`; omission
  remains unspecified. Static in-app dialogues are explicitly multiple-choice.

## Local checks

```sh
npm ci
npm test
npm run typecheck
npm run lint
BETTER_AUTH_URL=http://localhost:3000 \
  BETTER_AUTH_SECRET=local-build-placeholder-not-production-secret \
  ALLOWED_EMAIL=test@example.invalid npm run build
# Optional isolated browser checks, requires an installed Chromium and Node 22+:
CHROMIUM_PATH=/usr/bin/chromium npm run test:ui
# macOS with Google Chrome:
CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:ui
```

Database regression tests use PGlite in memory with synthetic users and all three
migrations. They never use `DATABASE_URL` or connect to production. Do not run
`vercel-build` for this review: it intentionally runs real configured migrations.

### Verification for this review (2026-10-05)

- TypeScript, ESLint, and all 30 schema/database/MCP/SSR/deployment-guard tests passed.
- All four isolated Chromium interaction tests passed: mobile layout, double clicks,
  failed saves and canonical retries, and reload/completion/daily fallback.
- `next build` passed against a fresh local PostgreSQL 17 database with synthetic
  auth settings. All three migrations ran in that isolated database.
- The built Next.js app was tested in Chrome with a synthetic owner: login gating,
  actual email/password login, exactly three choices, correct and incorrect answers,
  double click, reload resuming pending questions, source conversation links,
  progress explanations, separate recognition/free-response labels, daily fallback,
  and no other-user question exposure. Mobile (390px) and desktop (1440px)
  screenshots were inspected; no uncaught browser exceptions occurred.
- The authenticated app's response was deliberately dropped after the server
  committed an incorrect selection. Retry preserved the actual choice, returned
  the original result and explanation, kept one exercise, and left the word's
  review date unchanged. Progress now includes the saved Hebrew explanation.
- Real PostgreSQL connections exercised a conflicting answer while the first
  transaction held its lock. The second waited, then returned the first exercise
  without another schedule update. Eight simultaneous queue retries returned one
  question ID. MCP tools also ran against this database without mocked SQL.
- These checks used synthetic local learning data. Production OAuth/ChatGPT
  connectivity and a hosted staging deployment remain unverified; no production
  migration, live learning-data mutation, merge, or deployment was performed.

### Draft-PR deployment guard

The review branch `codex/conversation-practice-questions` is explicitly excluded
from Vercel Git auto-deployments in `vercel.json`. This guard is included before
first publication because the existing `vercel-build` command applies migrations.
The migration runner also refuses this exact Vercel Git branch before opening a
database connection as defense in depth. Other branches, including `main`, retain
Vercel's default behavior. Do not merge
or manually deploy this change until the migration target and rollout are approved.
See [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled).
