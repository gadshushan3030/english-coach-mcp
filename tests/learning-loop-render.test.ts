import assert from "node:assert/strict";
import { before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

let completion: string, rewrite: string, variant: string;
before(async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const bundle = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import {renderToStaticMarkup} from "react-dom/server";
      import {ReviewPractice} from "./app/(main)/practice/ReviewPractice";
      const base = {id:"review",source_question_id:"source",source_session_id:"session",revision:2,question:"Which sentence is correct?",choices:null,due_at:"2026-10-06T00:00:00Z",is_variant:false};
      const show = review => renderToStaticMarkup(<ReviewPractice reviews={[review]} embedded />);
      process.stdout.write(JSON.stringify([show({...base,stage:"completion",prompt:"I _____ home."}),show({...base,stage:"rewrite",prompt:"I go home yesterday."}),show({...base,stage:"rewrite",prompt:"She go home yesterday.",is_variant:true})]));
    ` },
    bundle: true, jsx: "automatic", write: false, platform: "node", format: "cjs",
    plugins: [{ name: "render-boundaries", setup(build) {
      build.onResolve({ filter: /^@\/app\/practice-actions$/ }, () => ({ path: "action", namespace: "mock" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "mock" }));
      build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
        contents: path === "action" ? 'export const saveReview = () => { throw new Error("No render-time writes"); };' : 'import {createElement} from "react"; export default function Link(props) { return createElement("a", props); }',
        resolveDir: root, loader: "js",
      }));
    } }],
  });
  const result = spawnSync(process.execPath, ["--input-type=commonjs"], { input: bundle.outputFiles[0].text, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  [completion, rewrite, variant] = JSON.parse(result.stdout);
});

test("completion renders a gap and a typed response without the original or corrected answer key", () => {
  assert.match(completion, /I _____ home\./);
  assert.match(completion, /השלמת משפט/);
  assert.match(completion, /הבדיקה משווה לניסוח שנלמד/);
  assert.doesNotMatch(completion, /I went home|I go home|aria-pressed|לתרגיל הבא/);
});
test("independent correction retains enough erroneous context to answer a generic source question", () => {
  assert.match(rewrite, /I go home yesterday\./);
  assert.match(rewrite, /תקן את משפט הדוגמה במלואו/);
  assert.match(rewrite, /תיקון משפט עצמאי/);
  assert.match(rewrite, /המשפט מהשיחה שלך/);
  assert.match(rewrite, /href="\/progress\/session"/);
  assert.doesNotMatch(rewrite, /I went home|התשובה המתאימה|aria-pressed/);
});
test("contextual variants are labeled as coach-written examples", () => {
  assert.match(variant, /דוגמה לתרגול שכתב המאמן/);
  assert.doesNotMatch(variant, /המשפט מהשיחה שלך/);
});
