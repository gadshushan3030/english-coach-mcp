# Conversation-derived practice questions

## Daily learning improvements (2026-10-06)

The current work adds `/practice` for one capped daily sequence and `/settings`
for goals, placement and a daily time budget. The first recognition answer stays
immutable. Migration `0004` seeds a separate scheduled skill and records each
later review as a new checked exercise. Wrong answers return after ten minutes;
successful recognition leads to gap completion after one day, then independent
sentence correction after three days. Successful correction uses longer intervals
up to thirty days. Optional `review_variants` on `queue_practice_question` introduce
new contexts; a new context restarts recognition before typed production.

Gap completion is stored as `gap_completion`, independent correction as
`free_response`. Expected-wording grading ignores case, surrounding whitespace,
curly apostrophes and terminal punctuation; grammatical differences remain
distinct. Alternative valid paraphrases can fail this constrained comparison,
which the UI explains. Invented variant examples are labelled as practice
examples, never as actual learner mistakes. Pending payloads omit the corrected
answer; a rewrite receives the erroneous example it must correct.

Migration `0005` adds soft archive/undo and idempotent flashcard marks; `0006`
adds user-scoped preferences and retry-safe placement evidence; `0007` suspends
scheduling for archived words across app and MCP writes while retaining checked
evidence. Re-adding an archived word restores its existing identity and history.

The six-question placement assessment estimates A0–B1 only. Other starting levels
can be selected manually. Authored dialogues cover A1, A2, B2 and C1 practice
bands; the actual dialogue level is shown separately from the chosen starting
level. Temporary microphone audio remains local, is not uploaded or assessed,
and is discarded on continuation or refresh. Conversations retain their draft,
selected answers and stable save request in per-user/day/dialogue session storage.

Progress now preserves source links and exact explanations for later reviews.
The delayed-vocabulary metric requires seven days since the immediately preceding
checked attempt, excluding immediate corrections. Self-assessment remains separate.

For rollout:

1. Compile the final application with `npm run build` before changing the target
   database. Rehearse the unapplied migrations, in filename order, on a branch or
   clone of the actual production database. Migration `0005` validates historical
   review ownership; `0007` requires the expected stored function bodies and fails
   its transaction if they have drifted.
2. Preserve a pre-release database snapshot and confirm the database URL used by
   the release. The runner acquires a stable session-level PostgreSQL advisory lock
   before reading migration history, serializing concurrent deployments on that
   database. A preview build must use its isolated database.
3. Apply all unapplied migrations before serving this application version.
   `vercel-build` runs migrations before compilation, and each migration commits
   separately. A later migration or build failure does not undo earlier commits.
4. Verify the hosted login, MCP connection, saving, canonical retries and refresh
   recovery before promoting the deployment. An application rollback must remain
   compatible with archived words and new exercise formats; it does not revert
   the database schema or its backfill.

The exact review branch's auto-deployment and migration guards remain active;
they do not protect other branches from using their configured database. Isolated
SQL regression tests cover all seven migrations; `npm run test:ui:all` exercises
mobile/desktop components with synthetic actions. Validation statements below
describe their dated verification runs, not a completed hosted release.

Latest release validation: 87 automated unit/schema/SQL/MCP/render and migration
runner tests passed, as did 47 Chromium interaction tests and TypeScript/ESLint.
An authenticated-production database backup was restored to an isolated local
PostgreSQL instance; migrations `0004`–`0007` applied successfully to that clone,
and a Turbopack production build completed against it without database errors.
The production database was confirmed to contain `0001`–`0003` before release.
The release branch disables automatic Git deployments; a production candidate
can be built with `vercel deploy --prod --skip-domain` and verified before domain
promotion. Such a candidate uses the production database and is not an isolated
preview. Hosted verification and the final deployment are recorded in the release PR.

Recording
playback is covered with Chromium's real MediaRecorder and a synthetic audio
signal: the resulting local Opus/WebM blob decodes to non-silent audio, loads in
the native audio element, and plays with an advancing playback clock and no
media error. Capture resources and blob URLs are released afterward. Physical
microphone capture and Safari playback have not been verified. Mobile and
desktop screenshots were inspected. Earlier validation compiled with Webpack
using synthetic auth settings; startup auth discovery logged the unavailable
local database, so that build is not an authenticated live-app verification.
Default Turbopack compilation was blocked by this execution environment's local
port restriction. No hosted OAuth roundtrip, staging deployment or production
migration was performed for these improvements.

## Word and sentence speech follow-up (2026-10-06)

`Speak` still uses the device/browser's text-to-speech engine. Voice enumeration
is warmed on mount and on `voiceschanged`; each tap reads the current catalogue,
preferring a local English voice and US English among equally local choices.
An initially empty catalogue still permits the browser's `en-US` default.
Voice enumeration follows the browser's [getVoices/voiceschanged API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices).
The first speech call stays synchronous inside the tap; there are no automatic
delayed retries that could lose the browser's required user activation.

One controller owns the speech queue. It avoids cancelling an idle engine,
resumes a paused engine, and ignores callbacks from superseded requests. Buttons
show loading/playback, stop on a second tap, and expose actionable errors and
manual retry. An eight-second startup watchdog handles engines that silently
fail to start; a separate bounded watchdog handles a missing terminal event.
Changing text remounts the button and releases its own request, so revisiting a
word cannot resurrect a cancelled playback state. Unmounting an unrelated
button cannot cancel the current word.

`node scripts/test-speech.mts` exercises these controls with a deterministic
speech-engine fixture in Chromium; it is also included in `npm run test:ui:all`.
All eighteen speech regressions passed, including actual conversation rows and
word-card layouts at 320 and 390 pixels. Failure captions occupy a full row so
they remain readable on narrow screens. The complete 44-test browser suite,
72 unit/schema/SQL/MCP/render tests, TypeScript and ESLint all passed afterward.
These are UI/lifecycle regressions, not proof of audible output on a particular
phone. The earlier native MediaRecorder test covers recorded-audio playback,
which is a separate browser facility. No deployment was performed here.

## Review scope

The assistant writes questions through MCP; no additional AI service is needed. `/talk`
loads the authenticated learner's unanswered questions, while scripted daily dialogues
remain available. A question is three-choice recognition practice, not proof that the
learner can independently produce the sentence.

Migration `0003_practice_questions.sql` creates a question queue and adds
response-format metadata without relabeling historical exercises. It was verified
in production migration history on 2026-10-06, before the daily-learning release.

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
