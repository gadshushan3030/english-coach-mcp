// Isolated component QA using installed Chromium's DevTools protocol.
// No Next server, account, credentials, database, or downloaded browser is used.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const root = fileURLToPath(new URL("..", import.meta.url));
let server: Server;
let browser: ChildProcess;
let browserDir: string;
let cdp: DevTools;
let origin: string;

class DevTools {
  socket: WebSocket;
  nextId = 0;
  pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  errors: string[] = [];

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.method === "Runtime.exceptionThrown") this.errors.push(JSON.stringify(message.params));
      if (!message.id) return;
      const request = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) request?.reject(new Error(JSON.stringify(message.error)));
      else request?.resolve(message.result);
    });
  }

  async send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

class Page {
  sessionId: string;

  constructor(sessionId: string) { this.sessionId = sessionId; }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const response = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, this.sessionId);
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return (response.result as { value: T }).value;
  }

  async wait(expression: string, message: string) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await this.evaluate<boolean>(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail(message);
  }

  async clickChoice(index: number, times = 1) {
    await this.evaluate(`(() => { const button = document.querySelectorAll('[role="group"] button')[${index}]; for (let i = 0; i < ${times}; i++) button.click(); })()`);
  }

  async click(text: string, times = 1) {
    await this.evaluate(`(() => { const button = Array.from(document.querySelectorAll('button')).find(node => node.textContent === ${JSON.stringify(text)}); if (!button) throw new Error('Button not found'); for (let i = 0; i < ${times}; i++) button.click(); })()`);
  }

  text(text: string) {
    return `document.body.textContent.includes(${JSON.stringify(text)})`;
  }

  async screenshot(name: string) {
    if (!process.env.QUIZ_SCREENSHOT_DIR) return;
    const { data } = await cdp.send("Page.captureScreenshot", { captureBeyondViewport: true }, this.sessionId);
    await writeFile(`${process.env.QUIZ_SCREENSHOT_DIR}/${name}.png`, Buffer.from(String(data), "base64"));
  }
}

before(async () => {
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: ["tests/ui/personalized-quiz.fixture.tsx"],
    bundle: true,
    jsx: "automatic",
    write: false,
    platform: "browser",
    format: "iife",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{
      name: "isolated-ui-boundaries",
      setup(build) {
        build.onResolve({ filter: /^@\/app\/actions$/ }, () => ({ path: "action", namespace: "mock" }));
        build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "mock" }));
        build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
          contents: path === "action"
            ? "export const answerPracticeQuestion = (id, index) => window.quizMock.answer(id, index);"
            : 'import {createElement} from "react"; export default function Link(props) { return createElement("a", props); }',
          resolveDir: root,
          loader: "js",
        }));
      },
    }],
  });
  const cssPath = `${root}/app/globals.css`;
  const css = await postcss([tailwindcss()]).process(await readFile(cssPath, "utf8"), { from: cssPath });
  server = createServer((request, response) => {
    if (request.url === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bundle.outputFiles[0].text);
    } else if (request.url === "/fixture.css") {
      response.setHeader("Content-Type", "text/css");
      response.end(css.css);
    } else {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html dir="rtl" lang="he"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" class="mx-auto flex max-w-2xl flex-col gap-4 px-5 py-6"></main><script src="/fixture.js"></script></body></html>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  browserDir = await mkdtemp(`${tmpdir()}/quiz-chromium-`);
  browser = spawn(process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", [
    "--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${browserDir}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const websocketUrl = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chromium did not start")), 10000);
    browser.once("error", (error) => { clearTimeout(timer); reject(error); });
    browser.once("exit", () => { clearTimeout(timer); reject(new Error(`Chromium exited before startup: ${output}`)); });
    browser.stderr!.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const socket = new WebSocket(websocketUrl);
  await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve(), { once: true }); socket.addEventListener("error", reject, { once: true }); });
  cdp = new DevTools(socket);
});

after(async () => {
  cdp?.socket.close();
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    const exited = new Promise((resolve) => browser.once("exit", resolve));
    browser.kill();
    const forceExit = setTimeout(() => browser.kill("SIGKILL"), 1000);
    await exited;
    clearTimeout(forceExit);
  }
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (browserDir) await rm(browserDir, { recursive: true, force: true });
});

async function freshPage(run: (page: Page) => Promise<void>) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = new Page(String(sessionId));
  cdp.errors = [];
  try {
    await cdp.send("Runtime.enable", {}, page.sessionId);
    await cdp.send("Page.enable", {}, page.sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, page.sessionId);
    await cdp.send("Page.navigate", { url: origin }, page.sessionId);
    await page.wait(page.text("Which sentence describes yesterday?"), "Initial question rendered");
    await run(page);
    assert.deepEqual(cdp.errors, [], "No uncaught browser errors");
  } finally {
    await cdp.send("Target.disposeBrowserContext", { browserContextId });
  }
}

test("pending choices hide feedback, preserve source links, and fit a mobile viewport", async () => {
  await freshPage(async (page) => {
    assert.equal(await page.evaluate("document.querySelectorAll('[role=group] button').length"), 3);
    assert.equal(await page.evaluate(page.text("זהו ההסבר בעברית")), false);
    assert.equal(await page.evaluate(page.text("לשאלה הבאה")), false);
    assert.equal(await page.evaluate("document.querySelector('a[href^=\"/progress/\"]').getAttribute('href')"), "/progress/11111111-1111-4111-8111-111111111111");
    assert.equal(await page.evaluate("document.querySelector('a[href^=\"/talk?d=\"]').getAttribute('href')"), "/talk?d=test-daily");
    assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await page.screenshot("quiz-pending");
  });
});

test("double clicks save once and revalidation preserves feedback until explicit next", async () => {
  await freshPage(async (page) => {
    await page.clickChoice(1, 2);
    assert.equal(await page.evaluate("window.quizMock.calls.length"), 1);
    assert.equal(await page.evaluate("Array.from(document.querySelectorAll('[role=group] button')).every(button => button.disabled)"), true);
    assert.equal(await page.evaluate(page.text("לשאלה הבאה")), false);
    await page.evaluate("window.quizMock.resolve()");
    await page.wait(page.text("נכון!"), "Correct result rendered");
    await page.evaluate("window.quizMock.revalidate()");
    assert.equal(await page.evaluate(page.text("Which sentence describes yesterday?")), true);
    assert.equal(await page.evaluate(page.text("זהו ההסבר בעברית")), true);
    await page.screenshot("quiz-feedback");
    await page.click("לשאלה הבאה", 2);
    await page.wait(page.text("Which sentence is correct?"), "Next question rendered");
    assert.equal(await page.evaluate(page.text("לשיחת המקור")), false);
    assert.equal(await page.evaluate(page.text("זהו ההסבר בעברית")), false);
  });
});

test("a failed save keeps the exact selection, retries it, and uses a canonical prior answer", async () => {
  await freshPage(async (page) => {
    await page.clickChoice(0);
    await page.evaluate("window.quizMock.reject()");
    await page.wait(page.text("ניסיון שמירה נוסף"), "Retry rendered");
    assert.equal(await page.evaluate("document.querySelectorAll('[role=group] button')[0].getAttribute('aria-pressed')"), "true");
    assert.equal(await page.evaluate(page.text("לשאלה הבאה")), false);
    assert.equal(await page.evaluate(page.text("זהו ההסבר בעברית")), false);
    await page.click("ניסיון שמירה נוסף", 2);
    assert.deepEqual(await page.evaluate("window.quizMock.calls"), [
      { questionId: "question-one", selectedIndex: 0 },
      { questionId: "question-one", selectedIndex: 0 },
    ]);
    await page.evaluate("window.quizMock.resolve(1)");
    await page.wait(page.text("כבר נשמרה תשובה לשאלה הזו."), "Canonical-choice notice rendered");
    assert.equal(await page.evaluate("document.querySelectorAll('[role=group] button')[1].getAttribute('aria-pressed')"), "true");
    assert.equal(await page.evaluate("document.querySelectorAll('[role=group] button')[0].getAttribute('aria-pressed')"), "false");
    assert.equal(await page.evaluate(page.text("נכון!")), true);
  });
});

test("reload resumes pending questions and the finished batch falls back to daily practice", async () => {
  await freshPage(async (page) => {
    await page.clickChoice(1);
    await page.evaluate("window.quizMock.resolve()");
    await page.wait(page.text("לשאלה הבאה"), "Saved answer rendered");
    await cdp.send("Page.reload", {}, page.sessionId);
    await page.wait(page.text("Which sentence is correct?"), "Reload resumes remaining question");
    assert.equal(await page.evaluate(page.text("Which sentence describes yesterday?")), false);
    await page.clickChoice(0);
    await page.evaluate("window.quizMock.resolve()");
    await page.wait(page.text("התשובה המתאימה"), "Incorrect result rendered");
    await page.click("סיום");
    await page.wait(page.text("סיימת את מקבץ השאלות"), "Batch completion rendered");
    assert.equal(await page.evaluate(page.text("0/1")), true);
    await page.click("בדיקת שאלות נוספות");
    await page.wait(page.text("אין כרגע שאלות אישיות להשלמה"), "Reload shows empty queue");
    assert.equal(await page.evaluate(page.text("Mock daily conversation")), true);
    assert.equal(await page.evaluate("document.querySelectorAll('[role=group]').length"), 0);
  });
});
