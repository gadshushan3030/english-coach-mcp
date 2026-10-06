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
    if (!process.env.SPEECH_SCREENSHOT_DIR) return;
    const { data } = await cdp.send("Page.captureScreenshot", { captureBeyondViewport: true }, this.sessionId);
    await writeFile(`${process.env.SPEECH_SCREENSHOT_DIR}/${name}.png`, Buffer.from(String(data), "base64"));
  }
}

before(async () => {
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: ["tests/ui/speech.fixture.tsx"],
    bundle: true,
    jsx: "automatic",
    write: false,
    platform: "browser",
    format: "iife",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{
      name: "isolated-speech-boundaries",
      setup(build) {
        build.onResolve({ filter: /^@\/app\/actions$/ }, () => ({ path: "actions", namespace: "mock" }));
        build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "mock" }));
        build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
          contents: path === "actions"
            ? 'export const saveConversation = () => { throw new Error("Speech QA must never save a conversation"); };'
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
  browserDir = await mkdtemp(`${tmpdir()}/speech-chromium-`);
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
    await page.wait(page.text("תרגול השמעה"), "Initial speech practice rendered");
    await run(page);
    assert.deepEqual(cdp.errors, [], "No uncaught browser errors");
  } finally {
    await page.evaluate("window.speechMock?.dispose()")
      .catch(() => { /* Browser context disposal below also releases resources after fixture failures. */ });
    await cdp.send("Target.disposeBrowserContext", { browserContextId });
  }
}


async function clickSpeaker(page: Page, id: "first" | "second", times = 1) {
  await page.evaluate(`(() => {
    const button = document.querySelector('[data-speech="${id}"] button');
    if (!button) throw new Error('Speaker not found');
    for (let index = 0; index < ${times}; index++) button.click();
  })()`, true);
}

async function buttonState(page: Page, id: "first" | "second") {
  return page.evaluate<{ label: string | null; pressed: string | null; busy: string | null }>(`(() => {
    const button = document.querySelector('[data-speech="${id}"] button');
    return { label: button.getAttribute('aria-label'), pressed: button.getAttribute('aria-pressed'), busy: button.getAttribute('aria-busy') };
  })()`);
}

function speakerText(id: "first" | "second", text: string) {
  return `document.querySelector('[data-speech="${id}"]')?.textContent.includes(${JSON.stringify(text)})`;
}

function speakCalls() {
  return "window.speechMock.calls.filter(call => call.action === 'speak')";
}

test("unsupported speech explains the failure and keeps both words usable without throwing", async () => {
  await freshPage(async (page) => {
    await clickSpeaker(page, "first");
    await page.wait(speakerText("first", "הדפדפן לא תומך בהקראה"), "Unsupported speech is explained");
    assert.equal(await page.evaluate(`${speakCalls()}.length`), 0);
    assert.match((await buttonState(page, "first")).label!, /ניסיון נוסף:/);
    await clickSpeaker(page, "second");
    await page.wait(speakerText("second", "הדפדפן לא תומך בהקראה"), "Other word also explains missing support");
    assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  }, "?unsupported=1");
});

test("a click selects a local English US voice synchronously and lifecycle events update accessible state", async () => {
  await freshPage(async (page) => {
    await clickSpeaker(page, "first");
    const requests = await page.evaluate<{ text: string; lang: string; voiceName: string; voiceLang: string; rate: number; inClickStack: boolean }[]>(speakCalls());
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], { action: "speak", text: "hello", lang: "en-US", rate: 0.9,
      voiceName: "English US local", voiceLang: "en-US", inClickStack: true });
    await page.wait(speakerText("first", "מכינים הקראה"), "Loading status rendered");
    const loading = await buttonState(page, "first");
    assert.equal(loading.label, "עצירת השמעת מילה ראשונה");
    assert.equal(loading.pressed, "true");
    assert.equal(loading.busy, "true");
    await page.evaluate("window.speechMock.start()");
    await page.wait(speakerText("first", "משמיע"), "Start event marks speaking");
    assert.notEqual((await buttonState(page, "first")).busy, "true");
    await page.evaluate("window.speechMock.end()");
    await page.wait("document.querySelector('[data-speech=first] button').getAttribute('aria-label') === 'השמעת מילה ראשונה'", "End event restores idle");
    assert.equal((await buttonState(page, "first")).pressed, "false");
    assert.equal(await page.evaluate("window.speechMock.calls.filter(call => call.action === 'cancel').length"), 0, "Idle engine never gets unnecessary cancellation");
    await page.screenshot("speech-idle-after-end");
  });
});

test("voices loading later are used on the next gesture while the initial empty list uses English fallback", async () => {
  await freshPage(async (page) => {
    await clickSpeaker(page, "first");
    assert.equal(await page.evaluate(`${speakCalls()}[0].voiceName`), null);
    assert.equal(await page.evaluate(`${speakCalls()}[0].lang`), "en-US");
    assert.equal(await page.evaluate(`${speakCalls()}[0].inClickStack`), true);
    await page.evaluate("window.speechMock.start(); window.speechMock.end(); window.speechMock.loadVoices()");
    await page.wait("document.querySelector('[data-speech=first] button').getAttribute('aria-pressed') === 'false'", "First utterance completed");
    await clickSpeaker(page, "second");
    assert.equal(await page.evaluate(`${speakCalls()}[1].voiceName`), "English US local");
    assert.equal(await page.evaluate(`${speakCalls()}[1].inClickStack`), true);
    assert.equal(await page.evaluate(`${speakCalls()}[1].text`), "thank you");
    await page.evaluate("window.speechMock.start(); window.speechMock.end()");
  }, "?voices=late");
});

test("a paused engine resumes before speaking and clicking its own active word stops it", async () => {
  await freshPage(async (page) => {
    await page.evaluate("window.speechMock.setPaused(true)");
    await clickSpeaker(page, "first");
    const calls = await page.evaluate<{ action: string }[]>("window.speechMock.calls");
    const resume = calls.findIndex(call => call.action === "resume");
    const speak = calls.findIndex(call => call.action === "speak");
    assert.ok(resume >= 0 && resume < speak, "Resume occurs inside the gesture before speak");
    assert.equal(await page.evaluate("window.speechMock.synthesis.paused"), false);
    await clickSpeaker(page, "first");
    await page.wait("document.querySelector('[data-speech=first] button').getAttribute('aria-pressed') === 'false'", "Stop click clears active state");
    assert.equal(await page.evaluate(`${speakCalls()}.length`), 1, "Stop does not create a second utterance");
    assert.equal(await page.evaluate("window.speechMock.calls.filter(call => call.action === 'cancel').length"), 1);
    assert.equal(await page.evaluate("Boolean(document.querySelector('[role=alert]'))"), false, "Intentional stopping does not display an error");
  });
});

test("switching words cancels the previous one and delayed errors cannot overwrite the new word", async () => {
  await freshPage(async (page) => {
    await clickSpeaker(page, "first");
    await page.evaluate("window.speechMock.start(0)");
    await clickSpeaker(page, "second");
    assert.equal(await page.evaluate(`${speakCalls()}.length`), 2);
    assert.equal(await page.evaluate("window.speechMock.calls.filter(call => call.action === 'cancel').length"), 1);
    await page.wait("document.querySelector('[data-speech=first] button').getAttribute('aria-pressed') === 'false'", "Old button becomes idle");
    assert.equal((await buttonState(page, "second")).pressed, "true");
    await page.evaluate("window.speechMock.start(1); window.speechMock.capturedError('network', 0); window.speechMock.capturedEnd(0)");
    await page.wait(speakerText("second", "משמיע"), "New utterance stays speaking");
    assert.equal(await page.evaluate("Boolean(document.querySelector('[role=alert]'))"), false);
    await page.evaluate("window.speechMock.end(1)");
    await page.wait("document.querySelector('[data-speech=second] button').getAttribute('aria-pressed') === 'false'", "New end event clears only its own word");
  });
});

test("engine errors display a retry on the same word and a retry starts in the click gesture", async () => {
  await freshPage(async (page) => {
    await clickSpeaker(page, "first");
    await page.evaluate("window.speechMock.error('not-allowed')");
    await page.wait(speakerText("first", "הדפדפן חסם את ההקראה"), "Browser blocking is explained");
    assert.equal((await buttonState(page, "first")).label, "ניסיון נוסף: השמעת מילה ראשונה");
    assert.equal((await buttonState(page, "first")).pressed, "false");
    await clickSpeaker(page, "first");
    assert.equal(await page.evaluate(`${speakCalls()}.length`), 2);
    assert.equal(await page.evaluate(`${speakCalls()}[1].inClickStack`), true);
    assert.equal(await page.evaluate(`${speakCalls()}[1].text`), "hello");
    await page.evaluate("window.speechMock.start(); window.speechMock.end()");
    await page.wait("document.querySelector('[data-speech=first] button').getAttribute('aria-label') === 'השמעת מילה ראשונה'", "Retry returns to idle after completion");
    assert.equal(await page.evaluate("Boolean(document.querySelector('[role=alert]'))"), false);
  });
});

test("an engine that never starts gets a bounded timeout and offers retry without stale events", async () => {
  await freshPage(async (page) => {
    await clickSpeaker(page, "first");
    await page.wait(speakerText("first", "ההקראה לא התחילה"), "Silent failure becomes a retryable error");
    assert.equal((await buttonState(page, "first")).label, "ניסיון נוסף: השמעת מילה ראשונה");
    assert.equal((await buttonState(page, "first")).pressed, "false");
    await clickSpeaker(page, "first");
    await page.evaluate("window.speechMock.start(1); window.speechMock.capturedError('network', 0)");
    await page.wait(speakerText("first", "משמיע"), "Retry can start despite a late error from timeout");
    assert.equal(await page.evaluate("Boolean(document.querySelector('[role=alert]'))"), false);
    await page.evaluate("window.speechMock.end(1)");
  }, "?timeout=fast");
});

test("removing an unrelated speaker leaves playback intact; removing its owner cancels it", async () => {
  await freshPage(async (page) => {
    await clickSpeaker(page, "first");
    await page.evaluate("window.speechMock.start()");
    await page.evaluate("window.speechMock.remove('second')");
    await page.wait("document.querySelector('[data-speech=second]') === null", "Unrelated speaker removed");
    assert.equal(await page.evaluate("window.speechMock.calls.filter(call => call.action === 'cancel').length"), 0);
    assert.equal(await page.evaluate("window.speechMock.synthesis.speaking"), true);
    await page.evaluate("window.speechMock.remove('first')");
    await page.wait("document.querySelector('[data-speech=first]') === null", "Owner removed");
    assert.equal(await page.evaluate("window.speechMock.calls.filter(call => call.action === 'cancel').length"), 1);
    assert.equal(await page.evaluate("window.speechMock.synthesis.speaking"), false);
    await page.evaluate("window.speechMock.mount()");
    await page.wait("Boolean(document.querySelector('[data-speech=second]'))", "Speakers can mount again");
    await clickSpeaker(page, "second");
    assert.equal(await page.evaluate(`${speakCalls()}.length`), 2);
    await page.evaluate("window.speechMock.start(); window.speechMock.end()");
  });
});

test("synchronous browser engine failure stays recoverable without an uncaught exception", async () => {
  await freshPage(async (page) => {
    await page.evaluate("window.speechMock.throwNextSpeak()");
    await clickSpeaker(page, "first");
    await page.wait(speakerText("first", "לא הצלחנו להשמיע"), "Synchronous failure is explained");
    await clickSpeaker(page, "first");
    assert.equal(await page.evaluate(`${speakCalls()}.length`), 2);
    assert.equal(await page.evaluate(`${speakCalls()}[1].inClickStack`), true);
    await page.evaluate("window.speechMock.start(); window.speechMock.end()");
  });
});


test("a local English accent is preferred over a remote US voice", async () => {
  await freshPage(async (page) => {
    await page.evaluate("window.speechMock.withoutLocalUS()");
    await clickSpeaker(page, "first");
    assert.equal(await page.evaluate(`${speakCalls()}[0].voiceName`), "English British local");
    assert.equal(await page.evaluate(`${speakCalls()}[0].lang`), "en-GB");
    assert.equal(await page.evaluate(`${speakCalls()}[0].inClickStack`), true);
    await page.evaluate("window.speechMock.start(); window.speechMock.end()");
  });
});

test("a rapid burst across speakers leaves only the latest word active and ignores old callbacks", async () => {
  await freshPage(async (page) => {
    await page.evaluate(`(() => {
      const first = document.querySelector('[data-speech="first"] button');
      const second = document.querySelector('[data-speech="second"] button');
      first.click(); second.click(); first.click();
    })()`, true);
    assert.deepEqual(await page.evaluate(`${speakCalls()}.map(call => call.text)`), ["hello", "thank you", "hello"]);
    await page.wait("document.querySelector('[data-speech=first] button').getAttribute('aria-pressed') === 'true' && document.querySelector('[data-speech=second] button').getAttribute('aria-pressed') === 'false'", "Only latest word remains active");
    await page.evaluate("window.speechMock.start(2); window.speechMock.capturedError('network',0); window.speechMock.capturedError('audio-hardware',1); window.speechMock.capturedEnd(0); window.speechMock.capturedEnd(1)");
    await page.wait(speakerText("first", "משמיע"), "Newest utterance ignores canceled callbacks");
    assert.equal(await page.evaluate("Boolean(document.querySelector('[role=alert]'))"), false);
    assert.equal(await page.evaluate("window.speechMock.calls.filter(call => call.action === 'cancel').length"), 2);
    await page.evaluate("window.speechMock.end(2)");
  });
});

test("unavailable English voices explain how to recover instead of claiming playback", async () => {
  await freshPage(async (page) => {
    await clickSpeaker(page, "first");
    await page.evaluate("window.speechMock.error('voice-unavailable')");
    await page.wait(speakerText("first", "אין קול אנגלי זמין"), "Missing English voice is explained");
    assert.equal((await buttonState(page, "first")).label, "ניסיון נוסף: השמעת מילה ראשונה");
    assert.equal((await buttonState(page, "first")).pressed, "false");
    assert.equal((await buttonState(page, "second")).label, "השמעת מילה שנייה");
    await page.screenshot("speech-voice-error");
  });
});


test("unexpected active cancellation is visible and retryable while deliberate stopping stays quiet", async () => {
  await freshPage(async (page) => {
    await clickSpeaker(page, "first");
    await page.evaluate("window.speechMock.error('canceled')");
    await page.wait(speakerText("first", "ההקראה הופסקה"), "Unexpected pending cancellation is explained");
    assert.equal((await buttonState(page, "first")).label, "ניסיון נוסף: השמעת מילה ראשונה");
    await clickSpeaker(page, "first");
    await page.evaluate("window.speechMock.start(); window.speechMock.error('interrupted')");
    await page.wait(speakerText("first", "ההקראה הופסקה"), "Unexpected speaking interruption is explained");
    await clickSpeaker(page, "first");
    await page.evaluate("window.speechMock.start(); window.speechMock.end()");
    await page.wait("document.querySelector('[data-speech=first] button').getAttribute('aria-pressed') === 'false'", "Recovery completes");
    assert.equal(await page.evaluate("Boolean(document.querySelector('[role=alert]'))"), false);
  });
});

for (const { layout, width } of [{ layout: "word", width: 390 }, { layout: "word", width: 320 }, { layout: "conversation", width: 390 }, { layout: "conversation", width: 320 }]) {
  test(`${layout} speaker loading and error captions fit a ${width}px phone layout`, async () => {
    await freshPage(async (page) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 740, deviceScaleFactor: 1, mobile: true }, page.sessionId);
      await page.wait("Boolean(document.querySelector('[data-speech=first] button[aria-label]'))", "Word speaker is available");
      assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, "Initial row fits");
      await clickSpeaker(page, "first");
      await page.wait(speakerText("first", "מכינים הקראה"), "Startup caption rendered");
      assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, "Loading caption stays within viewport");
      await page.evaluate("window.speechMock.error('voice-unavailable')");
      await page.wait(speakerText("first", "אין קול אנגלי זמין"), "Detailed error caption rendered");
      assert.equal(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, "Error caption stays within viewport");
      const target = await page.evaluate<{ width: number; height: number }>(`(() => {
        const rect = document.querySelector('[data-speech=first] button').getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })()`);
      assert.ok(target.width >= 44 && target.height >= 44, "Speaker remains a usable touch target");
      await page.screenshot(`speech-${layout}-${width}-mobile-error`);
    }, `?layout=${layout}`);
  });
}


test("reusing the word component A to B to A starts fresh instead of reviving a stale active state", async () => {
  await freshPage(async (page) => {
    await clickSpeaker(page, "first");
    await page.evaluate("window.speechMock.start(0)");
    await page.wait(speakerText("first", "משמיע"), "First word is speaking");
    await page.evaluate("window.speechMock.setText('goodbye')");
    await page.wait(speakerText("first", "goodbye"), "Next word rendered in reused parent");
    assert.equal((await buttonState(page, "first")).pressed, "false");
    await page.evaluate("window.speechMock.setText('hello')");
    await page.wait(speakerText("first", "hello"), "Original word rendered again");
    assert.equal((await buttonState(page, "first")).label, "השמעת מילה ראשונה");
    assert.equal((await buttonState(page, "first")).pressed, "false");
    await clickSpeaker(page, "first");
    assert.equal(await page.evaluate(`${speakCalls()}.length`), 2, "Returning to the first word starts a new utterance");
    assert.equal(await page.evaluate(`${speakCalls()}[1].text`), "hello");
    await page.evaluate("window.speechMock.start(1); window.speechMock.capturedError('network',0)");
    await page.wait(speakerText("first", "משמיע"), "Fresh utterance stays active despite stale old callback");
    await page.evaluate("window.speechMock.end(1)");
    await page.wait("document.querySelector('[data-speech=first] button').getAttribute('aria-pressed') === 'false'", "Fresh utterance finishes normally");
  });
});
