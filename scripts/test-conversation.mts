// Isolated component QA using installed Chromium's DevTools protocol.
// No Next server, account, credentials, database, or downloaded browser is used.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
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
  pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  errors: string[] = [];

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.method === "Runtime.exceptionThrown") this.errors.push(JSON.stringify(message.params));
      if (!message.id) return;
      const request = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (request) clearTimeout(request.timer);
      if (message.error) request?.reject(new Error(JSON.stringify(message.error)));
      else request?.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("CDP connection closed before its response"));
      }
      this.pending.clear();
    });
  }

  async send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const diagnostic = {
          keys: Object.keys(params),
          ...(typeof params.expression === "string" ? { expression: params.expression.slice(0, 160) } : {}),
          ...(typeof params.url === "string" ? { url: params.url.slice(0, 160) } : {}),
        };
        reject(new Error(`CDP ${method} timed out after 10000ms: ${JSON.stringify(diagnostic)}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params, sessionId }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

class Page {
  sessionId: string;

  constructor(sessionId: string) { this.sessionId = sessionId; }

  async evaluate<T = unknown>(expression: string, userGesture = false): Promise<T> {
    const response = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture }, this.sessionId);
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
    await this.evaluate(`(() => { const button = document.querySelectorAll('button[dir="ltr"]')[${index}]; for (let i = 0; i < ${times}; i++) button.click(); })()`);
  }

  async click(text: string, times = 1, userGesture = false) {
    await this.evaluate(`(() => { const button = Array.from(document.querySelectorAll('button')).find(node => node.textContent === ${JSON.stringify(text)}); if (!button) throw new Error('Button not found'); for (let i = 0; i < ${times}; i++) button.click(); })()`, userGesture);
  }

  text(text: string) {
    return `document.body.textContent.includes(${JSON.stringify(text)})`;
  }

  async screenshot(name: string) {
    if (!process.env.CONVERSATION_SCREENSHOT_DIR) return;
    const { data } = await cdp.send("Page.captureScreenshot", { captureBeyondViewport: true }, this.sessionId);
    await writeFile(`${process.env.CONVERSATION_SCREENSHOT_DIR}/${name}.png`, Buffer.from(String(data), "base64"));
  }
}

before(async () => {
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: ["tests/ui/conversation.fixture.tsx"],
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
            ? "export const saveConversation = (id, dialogue, picks, expectedUserId) => window.conversationMock.save(id, dialogue, picks, expectedUserId);"
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
  browserDir = await mkdtemp(`${tmpdir()}/conversation-chromium-`);
  browser = spawn(process.env.CHROMIUM_PATH ?? (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/chromium"), [
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

async function freshPage(run: (page: Page) => Promise<void>, query = "") {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = new Page(String(sessionId));
  cdp.errors = [];
  try {
    await cdp.send("Runtime.enable", {}, page.sessionId);
    await cdp.send("Page.enable", {}, page.sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, page.sessionId);
    await cdp.send("Page.navigate", { url: `${origin}${query}` }, page.sessionId);
    await page.wait(page.text("Hi! How are you?"), "Initial conversation rendered");
    await run(page);
    assert.deepEqual(cdp.errors, [], "No uncaught browser errors");
  } finally {
    await page.evaluate("window.conversationMock?.disposeAudio()")
      .catch(() => { /* Browser context disposal below also releases resources after fixture failures. */ });
    await cdp.send("Target.disposeBrowserContext", { browserContextId });
  }
}

async function finishConversation(page: Page, waitForSaving = true) {
  const answers = ["I'm fine, thanks. And you?", "My name is Gad.", "Nice to meet you too."];
  const questions = ["Hi! How are you?", "I'm good. What's your name?", "Nice to meet you, Gad!"];
  for (let index = 0; index < answers.length; index++) {
    await page.wait(`document.querySelectorAll('button[dir="ltr"]').length === 3 && document.body.textContent.includes(${JSON.stringify(questions[index])})`, "Current turn available");
    await page.click(answers[index], 2);
    await page.wait(page.text("המשך"), "Feedback available");
    await page.click("המשך", 2);
  }
  if (waitForSaving) await page.wait(page.text("בשמירה…"), "Finished conversation is saving");
}

test("mobile conversation fits before and after choosing an answer; microphone is explicit", async () => {
  await freshPage(async (page) => {
    assert.equal(await page.evaluate("document.querySelectorAll('button[dir=\"ltr\"]').length"), 3);
    assert.equal(await page.evaluate("window.conversationMock.micRequests"), 0);
    assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await page.click("I'm fine, thanks. And you?");
    await page.wait(page.text("לתרגל בקול"), "Recording option available");
    assert.equal(await page.evaluate("window.conversationMock.micRequests"), 0);
    assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    assert.equal(await page.evaluate(page.text("אין העלאה, תמלול או ציון הגייה")), true);
    assert.equal(await page.evaluate(page.text("נמחקת בהמשך לתרגיל הבא או ברענון")), true);
    await page.screenshot("conversation-mobile");
  });
});

test("failed completion blocks navigation, preserves payload and retries duplicate clicks once", async () => {
  await freshPage(async (page) => {
    await finishConversation(page);
    assert.equal(await page.evaluate("window.conversationMock.calls.length"), 1);
    assert.equal(await page.evaluate("window.conversationMock.completions"), 0);
    assert.equal(await page.evaluate("document.querySelector('a[href=\"/talk?d=coffee\"]') === null"), true);
    const original = await page.evaluate("window.conversationMock.calls[0]");
    await page.evaluate("window.conversationMock.reject()");
    await page.wait(page.text("ניסיון שמירה נוסף"), "Retry available");
    await page.click("ניסיון שמירה נוסף", 2);
    assert.equal(await page.evaluate("window.conversationMock.calls.length"), 2);
    assert.deepEqual(await page.evaluate("window.conversationMock.calls[1]"), original);
    await page.evaluate("window.conversationMock.resolve()");
    await page.wait(page.text("נשמר בהתקדמות"), "Confirmed completion available");
    await page.wait("window.conversationMock.completions === 1", "Callback called once");
    assert.equal(await page.evaluate("document.querySelector('a[href=\"/talk?d=coffee\"]').textContent"), "שיחה נוספת");
    await page.evaluate("window.conversationMock.revalidate()");
    assert.equal(await page.evaluate("window.conversationMock.completions"), 1);
    assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await page.screenshot("conversation-complete");
  });
});

test("refresh restores selected answers and failed completion retries with its original ID", async () => {
  await freshPage(async (page) => {
    await page.click("I am twenty years.");
    await page.wait(page.text("המשך"), "Chosen answer available");
    await cdp.send("Page.reload", {}, page.sessionId);
    await page.wait(page.text("המשכנו מהמקום שבו עצרת"), "Selection restored after refresh");
    assert.equal(await page.evaluate("Array.from(document.querySelectorAll('button[dir=\"ltr\"]')).every(button => button.disabled)"), true);
    await page.click("המשך", 2);
    await page.wait(page.text("I'm good. What's your name?"), "Second turn available");
    await page.click("My name is Gad.", 2);
    await page.click("המשך", 2);
    await page.wait(page.text("Nice to meet you, Gad!"), "Final turn available");
    await page.click("Nice to meet you too.", 2);
    await page.click("המשך", 2);
    await page.wait("window.conversationMock.calls.length === 1", "Save attempted");
    const original = await page.evaluate("window.conversationMock.calls[0]");
    await page.evaluate("window.conversationMock.reject()");
    await page.wait(page.text("ניסיון שמירה נוסף"), "Error visible");
    await cdp.send("Page.reload", {}, page.sessionId);
    await page.wait("window.conversationMock?.calls?.length === 2", "Refresh retries completed practice");
    assert.deepEqual(await page.evaluate("window.conversationMock.calls[1]"), original);
    await page.evaluate("window.conversationMock.resolve()");
    await page.wait(page.text("נשמר בהתקדמות"), "Confirmation visible");
    await cdp.send("Page.reload", {}, page.sessionId);
    await page.wait(page.text("נשמר בהתקדמות"), "Confirmed draft restored");
    assert.equal(await page.evaluate("window.conversationMock.calls.length"), 2);
    await cdp.send("Page.navigate", { url: `${origin}?learner=user-two` }, page.sessionId);
    await page.wait(page.text("Hi! How are you?"), "Other learner gets fresh practice");
    assert.equal(await page.evaluate("document.querySelectorAll('button[dir=\"ltr\"]:not([disabled])').length"), 3);
    assert.equal(await page.evaluate(page.text("נשמר בהתקדמות")), false);
  });
});

test("a replay displays the server's saved answers and persists their canonical score", async () => {
  await freshPage(async (page) => {
    await finishConversation(page);
    const original = await page.evaluate<{ requestId: string; picks: number[]; expectedUserId: string }>("window.conversationMock.calls[0]");
    assert.equal(original.expectedUserId, "user-one");
    assert.deepEqual(original.picks, [0, 1, 2]);
    await page.evaluate("window.conversationMock.resolve([1, 1, 2])");
    await page.wait(page.text("נשמר בהתקדמות"), "Canonical result confirmed");
    await page.wait(page.text("מוצגות הבחירות שנשמרו"), "Divergent replay is explained");
    assert.equal(await page.evaluate("document.querySelector('.tabular-nums').textContent"), "2/3");
    const saved = await page.evaluate<{ requestId: string; picks: number[]; saved: boolean }>("JSON.parse(sessionStorage.getItem('english-coach:conversation:v1:user-one%3A2026-10-06:greetings'))");
    assert.equal(saved.requestId, original.requestId);
    assert.deepEqual(saved.picks, [1, 1, 2]);
    assert.equal(saved.saved, true);
    await page.wait("window.conversationMock.completions === 1", "Canonical result notifies once");
    await cdp.send("Page.reload", {}, page.sessionId);
    await page.wait(page.text("נשמר בהתקדמות"), "Canonical confirmation survives reload");
    assert.equal(await page.evaluate("document.querySelector('.tabular-nums').textContent"), "2/3");
    assert.equal(await page.evaluate("window.conversationMock.calls.length"), 1);
  });
});

test("the rendered learner identity survives an account change and a rejected save stays unconfirmed", async () => {
  await freshPage(async (page) => {
    await page.evaluate("window.conversationMock.currentUserId = 'user-two'");
    await finishConversation(page, false);
    await page.wait(page.text("השמירה נכשלה"), "Stale-account save is rejected");
    assert.equal(await page.evaluate("window.conversationMock.calls[0].expectedUserId"), "user-one");
    assert.equal(await page.evaluate("window.conversationMock.completions"), 0);
    assert.equal(await page.evaluate(page.text("נשמר בהתקדמות")), false);
    assert.equal(await page.evaluate("document.querySelector('a[href=\"/talk?d=coffee\"]') === null"), true);
    await page.evaluate("window.conversationMock.currentUserId = 'user-one'");
    await page.click("ניסיון שמירה נוסף");
    await page.wait(page.text("בשמירה…"), "Original learner can retry");
    assert.deepEqual(await page.evaluate("window.conversationMock.calls[1]"), await page.evaluate("window.conversationMock.calls[0]"));
    await page.evaluate("window.conversationMock.resolve()");
    await page.wait(page.text("נשמר בהתקדמות"), "Original identity confirmation succeeds");
    assert.equal(await page.evaluate("window.conversationMock.completions"), 1);
  });
});

test("missing or incomplete server confirmation cannot mark a finished draft saved", async () => {
  await freshPage(async (page) => {
    await finishConversation(page);
    for (const response of ["undefined", "({ picks: [0], correct: 1, total: 3 })", "({ picks: [0, 0, 0], correct: 0, total: 3 })"]) {
      await page.evaluate(`window.conversationMock.resolveResult(${response})`);
      await page.wait(page.text("השמירה נכשלה"), "Invalid result remains retryable");
      assert.equal(await page.evaluate(page.text("נשמר בהתקדמות")), false);
      assert.equal(await page.evaluate("window.conversationMock.completions"), 0);
      await page.click("ניסיון שמירה נוסף");
      await page.wait(page.text("בשמירה…"), "Same payload retries after invalid confirmation");
    }
    assert.equal(await page.evaluate("window.conversationMock.calls.length"), 4);
    await page.evaluate("window.conversationMock.resolve()");
    await page.wait(page.text("נשמר בהתקדמות"), "Complete result finally confirms");
    assert.equal(await page.evaluate("window.conversationMock.completions"), 1);
  });
});

test("microphone denial and unsupported recording provide useful errors without grading", async () => {
  await freshPage(async (page) => {
    await page.click("I'm fine, thanks. And you?");
    await page.click("התחלת הקלטה", 2);
    await page.wait(page.text("אין הרשאה למיקרופון"), "Denied permission is explained");
    assert.equal(await page.evaluate("window.conversationMock.micRequests"), 1);
    assert.equal(await page.evaluate("window.conversationMock.calls.length"), 0);
    await page.evaluate("window.conversationMock.unsupported()");
    await page.click("התחלת הקלטה");
    await page.wait(page.text("הדפדפן לא תומך בהקלטה כאן"), "Unsupported browser is explained");
    assert.equal(await page.evaluate("window.conversationMock.micRequests"), 1);
  });
});

test("recording playback stays local and releases tracks and URLs when advancing", async () => {
  await freshPage(async (page) => {
    await page.click("I'm fine, thanks. And you?");
    await page.evaluate("window.conversationMock.micMode = 'success'");
    await page.click("התחלת הקלטה", 2);
    await page.wait(page.text("מקליטים…"), "Recording active");
    await page.click("עצירה · 0/60");
    await page.wait("Boolean(document.querySelector('audio'))", "Local playback available");
    assert.equal(await page.evaluate("document.querySelector('audio').src.startsWith('blob:')"), true);
    assert.equal(await page.evaluate("window.conversationMock.tracksStopped"), 1);
    assert.equal(await page.evaluate("window.conversationMock.urlsCreated"), 1);
    await page.click("המשך");
    await page.wait(page.text("I'm good. What's your name?"), "Next turn available");
    assert.equal(await page.evaluate("window.conversationMock.urlsRevoked"), 1);
    assert.equal(await page.evaluate("document.querySelector('audio') === null"), true);
    assert.equal(await page.evaluate("window.conversationMock.calls.length"), 0);
    await page.click("My name is Gad.");
    await page.evaluate("window.conversationMock.micMode = 'deferred'");
    await page.click("התחלת הקלטה");
    await page.wait(page.text("פותחים מיקרופון…"), "Permission request pending");
    await page.click("המשך");
    await page.evaluate("window.conversationMock.resolveMic()");
    await page.wait("window.conversationMock.tracksStopped === 2", "Late microphone stream is released after unmount");
  });
});

test("explicit repeat starts a fresh request without writing until another run is complete", async () => {
  await freshPage(async (page) => {
    await finishConversation(page);
    const firstRequest = await page.evaluate("window.conversationMock.calls[0].requestId");
    await page.evaluate("window.conversationMock.resolve()");
    await page.wait(page.text("תרגול חוזר"), "Repeat available only after confirmation");
    await page.click("תרגול חוזר", 2);
    await page.wait("document.querySelectorAll('button[dir=\"ltr\"]:not([disabled])').length === 3", "New run available");
    assert.equal(await page.evaluate("window.conversationMock.calls.length"), 1);
    assert.equal(await page.evaluate("document.querySelector('audio') === null"), true);
    await finishConversation(page);
    assert.equal(await page.evaluate("window.conversationMock.calls.length"), 2);
    assert.notEqual(await page.evaluate("window.conversationMock.calls[1].requestId"), firstRequest);
    await page.evaluate("window.conversationMock.resolve()");
    await page.wait("window.conversationMock.completions === 2", "Each completed run notifies once");
  });
});


test("real MediaRecorder encodes a synthetic signal that the audio element decodes and plays", async () => {
  await freshPage(async (page) => {
    assert.equal(await page.evaluate("window.conversationMock.nativeAudio"), true);
    await page.click("I'm fine, thanks. And you?");
    await page.click("התחלת הקלטה", 1, true);
    await page.wait(page.text("מקליטים…"), "Native browser recording active");
    // Headless audio startup can lag wall-clock time; stop only after the real
    // rendering clock has supplied at least 1.2 seconds since recorder start.
    await page.wait(`(() => {
      const resource = window.conversationMock.audioResources[0];
      const started = window.conversationMock.nativeEvents.find(event => event.event === 'start');
      return Boolean(resource && started && typeof started.detail?.contextTime === 'number'
        && resource.context.currentTime - started.detail.contextTime >= 1.2);
    })()`, "Native recording receives at least 1.2 seconds of rendered audio");
    await page.evaluate(`(() => {
      const stop = Array.from(document.querySelectorAll('button')).find(node => node.textContent.startsWith('עצירה ·'));
      if (!stop) throw new Error('Recording stop button missing');
      stop.click();
    })()`, true);
    try {
      await page.wait("Boolean(document.querySelector('audio'))", "Encoded audio available for playback");
    } catch (error) {
      const diagnostics = await page.evaluate(`(() => ({
        body: document.body.innerText,
        blobs: window.conversationMock.recordedBlobs,
        events: window.conversationMock.nativeEvents,
        recorders: window.conversationMock.nativeRecorders.map(recorder => ({ state: recorder.state, mimeType: recorder.mimeType })),
        resources: window.conversationMock.audioResources.map(({context,stream}) => ({ contextState: context.state, contextTime: context.currentTime, tracks: stream.getTracks().map(track => ({ state: track.readyState, muted: track.muted, enabled: track.enabled })) })),
      }))()`);
      process.stdout.write(`Native audio failure diagnostics: ${JSON.stringify(diagnostics)}\n`);
      throw error;
    }
    await page.wait("document.querySelector('audio').readyState >= HTMLMediaElement.HAVE_CURRENT_DATA", "Audio decoder loaded actual media data");
    const encoded = await page.evaluate<{ bytes: number; type: string }[]>("window.conversationMock.recordedBlobs");
    assert.equal(encoded.length, 1);
    assert.ok(encoded[0].bytes > 128, "Recording contains more than an empty container");
    assert.match(encoded[0].type, /^audio\//);
    const decoded = await page.evaluate<{ duration: number; channels: number; sampleRate: number; rms: number }>(`(async () => {
      const context = new AudioContext();
      try {
        const source = document.querySelector('audio').src;
        if (!source.startsWith('blob:')) throw new Error('Audio must remain local');
        const response = await fetch(source);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        const samples = buffer.getChannelData(0);
        const meanSquare = samples.reduce((sum, value) => sum + value * value, 0) / samples.length;
        return { duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate, rms: Math.sqrt(meanSquare) };
      } finally {
        await context.close();
      }
    })()`);
    assert.ok(decoded.duration > 0.75 && decoded.duration < 5, "Decoded duration matches the short recording");
    assert.ok(decoded.rms > 0.01, "Decoded audio contains the synthetic tone rather than silence");
    assert.ok(decoded.channels > 0 && decoded.sampleRate > 0);
    const initial = await page.evaluate<{ duration: string; readyState: number; error: number | null }>(`(() => {
      const audio = document.querySelector('audio');
      return { duration: String(audio.duration), readyState: audio.readyState, error: audio.error?.code ?? null };
    })()`);
    assert.equal(initial.error, null);
    assert.ok(Number(initial.duration) > 0, "Loaded media metadata has a positive duration");
    await page.evaluate("document.querySelector('audio').play().then(() => true)", true);
    await page.wait("document.querySelector('audio').currentTime >= 0.2", "Native audio playback clock advances");
    const playback = await page.evaluate<{ currentTime: number; paused: boolean; error: number | null }>(`(() => {
      const audio = document.querySelector('audio');
      const result = { currentTime: audio.currentTime, paused: audio.paused, error: audio.error?.code ?? null };
      audio.pause();
      return result;
    })()`);
    assert.ok(playback.currentTime >= 0.2);
    assert.equal(playback.paused, false);
    assert.equal(playback.error, null);
    assert.equal(await page.evaluate("window.conversationMock.tracksStopped"), 1);
    await page.wait("window.conversationMock.audioResources.every(({context,stream}) => context.state === 'closed' && stream.getTracks().every(track => track.readyState === 'ended'))", "Synthetic audio capture resources released");
    assert.equal(await page.evaluate("window.conversationMock.calls.length"), 0, "Recorded audio is not uploaded or submitted");
    await page.click("המשך");
    await page.wait(page.text("I'm good. What's your name?"), "Continuing discards local recording");
    assert.equal(await page.evaluate("window.conversationMock.urlsRevoked"), 1);
    assert.equal(await page.evaluate("document.querySelector('audio') === null"), true);
    process.stdout.write(`Native audio evidence: ${JSON.stringify({ encoded: encoded[0], decoded, metadata: initial, playback })}\n`);
  }, "?native_audio=1");
});
