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

  async typeAnswer(answer: string) {
    await this.evaluate(`(() => { const input = document.querySelector("input"); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, ${JSON.stringify(answer)}); input.dispatchEvent(new Event("input", {bubbles:true})); })()`);
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
    if (!process.env.LEARNING_SCREENSHOT_DIR) return;
    const { data } = await cdp.send("Page.captureScreenshot", { captureBeyondViewport: true }, this.sessionId);
    await writeFile(`${process.env.LEARNING_SCREENSHOT_DIR}/${name}.png`, Buffer.from(String(data), "base64"));
  }
}

before(async () => {
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: ["tests/ui/learning-loop.fixture.tsx"],
    bundle: true,
    jsx: "automatic",
    write: false,
    platform: "browser",
    format: "iife",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{
      name: "isolated-ui-boundaries",
      setup(build) {
        build.onResolve({ filter: /^@\/app\/practice-actions$/ }, () => ({ path: "action", namespace: "mock" }));
        build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "mock" }));
        build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
          contents: path === "action"
            ? "export const saveReview = (input) => window.learningMock.answer(input);"
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
  browserDir = await mkdtemp(`${tmpdir()}/learning-chromium-`);
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

async function freshPage(run: (page: Page) => Promise<void>, stage = "recognition", variant = false) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = new Page(String(sessionId));
  cdp.errors = [];
  try {
    await cdp.send("Runtime.enable", {}, page.sessionId);
    await cdp.send("Page.enable", {}, page.sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, page.sessionId);
    await cdp.send("Page.navigate", { url: `${origin}?stage=${stage}${variant ? "&variant=1" : ""}` }, page.sessionId);
    await page.wait(page.text("חוזרים על מה שלמדת"), "Initial review rendered");
    await run(page);
    assert.deepEqual(cdp.errors, [], "No uncaught browser errors");
  } finally {
    await cdp.send("Target.disposeBrowserContext", { browserContextId });
  }
}

test("completion hides the expected word and original, preserves source links, and fits mobile", async () => {
  await freshPage(async (page) => {
    assert.equal(await page.evaluate(page.text("I _____ to work yesterday.")), true);
    assert.equal(await page.evaluate(page.text("I went to work yesterday.")), false);
    assert.equal(await page.evaluate(page.text("I go to work yesterday.")), false);
    assert.equal(await page.evaluate(page.text("ההסבר שנשמר")), false);
    assert.equal(await page.evaluate("document.querySelectorAll('[role=group] button').length"), 0);
    assert.equal(await page.evaluate("document.querySelector('a[href^=\"/progress/\"]').getAttribute('href')"), "/progress/11111111-1111-4111-8111-111111111111");
    assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await page.screenshot("review-completion");
  }, "completion");
});

test("rewrite provides erroneous context, hides the key, and clearly labels a contextual variant", async () => {
  await freshPage(async (page) => {
    assert.equal(await page.evaluate(page.text("I go to work yesterday.")), true);
    assert.equal(await page.evaluate(page.text("I went to work yesterday.")), false);
    assert.equal(await page.evaluate(page.text("תיקון משפט עצמאי")), true);
    assert.equal(await page.evaluate(page.text("דוגמה לתרגול שכתב המאמן")), true);
    assert.equal(await page.evaluate(page.text("המשפט מהשיחה שלך")), false);
    assert.equal(await page.evaluate("document.querySelector('input').getAttribute('placeholder')"), "Write the complete sentence");
    assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await page.screenshot("review-rewrite");
  }, "rewrite", true);
});

test("double submit saves once; failure freezes and retries exactly the same typed payload", async () => {
  await freshPage(async (page) => {
    await page.typeAnswer("go");
    await page.wait("!document.querySelector('button[type=submit]').disabled", "Typed answer can be submitted");
    await page.click("בדיקת תשובה", 2);
    assert.equal(await page.evaluate("window.learningMock.calls.length"), 1);
    assert.equal(await page.evaluate("document.querySelector('input').disabled"), true);
    assert.equal(await page.evaluate(page.text("I went to work yesterday.")), false);
    await page.evaluate("window.learningMock.reject()");
    await page.wait(page.text("ניסיון שמירה נוסף"), "Retry rendered");
    assert.equal(await page.evaluate("document.querySelector('input').value"), "go");
    assert.equal(await page.evaluate("document.querySelector('input').disabled"), true);
    await page.click("ניסיון שמירה נוסף", 2);
    const calls = await page.evaluate<unknown[]>("window.learningMock.calls");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1], "Request id, review revision and answer are retained on retry");
    await page.evaluate('window.learningMock.resolve("went")');
    await page.wait(page.text("מתאים לניסוח שנלמד!"), "Canonical result rendered");
    assert.equal(await page.evaluate("document.querySelector('input').value"), "went", "Typed feedback shows the saved canonical answer");
    assert.equal(await page.evaluate(page.text("I went to work yesterday.")), true);
    assert.equal(await page.evaluate(page.text("ההסבר שנשמר")), true);
    await page.evaluate("window.learningMock.revalidate()");
    assert.equal(await page.evaluate(page.text("השלמת משפט")), true);
    assert.equal(await page.evaluate(page.text("I went to work yesterday.")), true);
    await page.screenshot("review-feedback");
    await page.click("לתרגיל הבא", 2);
    await page.wait(page.text("תיקון משפט עצמאי"), "Explicit next advances exactly once");
    assert.equal(await page.evaluate(page.text("ההסבר שנשמר")), false);
  }, "completion");
});

test("recognition retries retain choice and display the returned canonical selection", async () => {
  await freshPage(async (page) => {
    await page.clickChoice(0, 2);
    assert.equal(await page.evaluate("window.learningMock.calls.length"), 1);
    await page.evaluate("window.learningMock.reject()");
    await page.wait(page.text("ניסיון שמירה נוסף"), "Recognition retry rendered");
    await page.click("ניסיון שמירה נוסף", 2);
    const calls = await page.evaluate<unknown[]>("window.learningMock.calls");
    assert.deepEqual(calls[0], calls[1]);
    await page.evaluate("window.learningMock.resolve(1)");
    await page.wait(page.text("מתאים לניסוח שנלמד!"), "Canonical choice result rendered");
    assert.equal(await page.evaluate("document.querySelectorAll('[role=group] button')[1].getAttribute('aria-pressed')"), "true");
    assert.equal(await page.evaluate("document.querySelectorAll('[role=group] button')[0].getAttribute('aria-pressed')"), "false");
  });
});

test("a completed rewrite fires the daily callback once and retains saved feedback until next", async () => {
  await freshPage(async (page) => {
    await page.typeAnswer("I went to work yesterday.");
    await page.wait("!document.querySelector('button[type=submit]').disabled", "Rewrite can be submitted");
    await page.click("בדיקת תשובה", 2);
    assert.equal(await page.evaluate("window.learningMock.calls.length"), 1);
    await page.evaluate("window.learningMock.resolve()");
    await page.wait(page.text("סיום החזרות"), "Last answer feedback rendered");
    assert.equal(await page.evaluate("window.learningMock.completions"), 0);
    await page.click("סיום החזרות", 2);
    await page.wait(page.text("Mock next daily stage"), "Completion callback advanced daily stage");
    assert.equal(await page.evaluate("window.learningMock.completions"), 1);
    assert.equal(await page.evaluate(page.text("החזרות נשמרו")), true);
    assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await page.screenshot("review-complete");
  }, "rewrite");
});
