import assert from "node:assert/strict";
import { before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

let pending: string;
let empty: string;

before(async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const bundle = await build({
    absWorkingDir: root,
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `
        import {renderToStaticMarkup} from "react-dom/server";
        import {PersonalizedQuiz} from "./app/(main)/talk/PersonalizedQuiz";
        const questions = [{id: "q-one", original: "I go yesterday.", question: "Which is correct?", choices: ["I go yesterday.", "I went yesterday.", "I will go yesterday."], source_session_id: "source-session"}];
        const render = (initialQuestions) => renderToStaticMarkup(<PersonalizedQuiz initialQuestions={initialQuestions} dailyId="daily-example" dailyConversation={<p>Preserved daily conversation</p>} />);
        process.stdout.write(JSON.stringify([render(questions), render([])]));
      `,
    },
    bundle: true,
    jsx: "automatic",
    write: false,
    platform: "node",
    format: "cjs",
    plugins: [{
      name: "render-only-boundaries",
      setup(build) {
        build.onResolve({ filter: /^@\/app\/actions$/ }, () => ({ path: "action", namespace: "mock" }));
        build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "mock" }));
        build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
          contents: path === "action"
            ? 'export const answerPracticeQuestion = () => { throw new Error("Rendering must never submit an answer"); };'
            : 'import {createElement} from "react"; export default function Link(props) { return createElement("a", props); }',
          resolveDir: root,
          loader: "js",
        }));
      },
    }],
  });
  const result = spawnSync(process.execPath, ["--input-type=commonjs"], {
    input: bundle.outputFiles[0].text,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  [pending, empty] = JSON.parse(result.stdout);
});

test("pending quiz renders exactly three choices, original context, and source/daily links", () => {
  assert.equal((pending.match(/aria-pressed="false"/g) ?? []).length, 3);
  assert.match(pending, /Which is correct\?/);
  assert.match(pending, /I go yesterday\./);
  assert.match(pending, /href="\/progress\/source-session"/);
  assert.match(pending, /href="\/talk\?d=daily-example"/);
  assert.match(pending, /זיהוי תשובה/);
  assert.match(pending, /ניסוח עצמאי/);
});

test("pending markup does not imply a checked answer or render feedback/next controls", () => {
  assert.doesNotMatch(pending, /נכון!|התשובה המתאימה|לשאלה הבאה|נשמר בהתקדמות|Preserved daily conversation/);
});

test("an empty personalized queue explains coach-created questions and retains daily practice", () => {
  assert.match(empty, /אין כרגע שאלות אישיות להשלמה/);
  assert.match(empty, /כשהמאמן ישמור שאלות/);
  assert.match(empty, /Preserved daily conversation/);
  assert.doesNotMatch(empty, /aria-pressed/);
});
