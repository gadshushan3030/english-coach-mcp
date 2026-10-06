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
    if (!process.env.WORKFLOW_SCREENSHOT_DIR) return;
    const { data } = await cdp.send("Page.captureScreenshot", { captureBeyondViewport: true }, this.sessionId);
    await writeFile(`${process.env.WORKFLOW_SCREENSHOT_DIR}/${name}.png`, Buffer.from(String(data), "base64"));
  }
}

before(async () => {
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: ["tests/ui/workflow.fixture.tsx"],
    bundle: true,
    jsx: "automatic",
    write: false,
    platform: "browser",
    format: "iife",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{
      name: "isolated-ui-boundaries",
      setup(build) {
        build.onResolve({ filter: /^@\/app\/(?:actions|word-actions|practice-actions|profile-actions)$/ }, () => ({ path: "action", namespace: "mock" }));
        build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "mock" }));
        build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
          contents: path === "action"
            ? "export const answerPracticeQuestion = (...args) => window.workflowMock.answer(...args); export const saveConversation = (...args) => window.workflowMock.conversation(...args); export const reviewWordOnce = (...args) => window.workflowMock.mark(...args); export const saveReview = (...args) => window.workflowMock.review(...args); export const saveLearnerProfile = (...args) => window.workflowMock.profile(...args);"
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
  browserDir = await mkdtemp(`${tmpdir()}/workflow-chromium-`);
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
    await cdp.send("Page.navigate", { url: origin + query }, page.sessionId);
    await page.wait(page.text("Workflow fixture"), "Initial question rendered");
    await run(page);
    assert.deepEqual(cdp.errors, [], "No uncaught browser errors");
  } finally {
    await cdp.send("Target.disposeBrowserContext", { browserContextId });
  }
}


async function setInput(page: Page, selector: string, value: string) {
  await page.evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
}

test("the daily route completes all four stages, saves once and resumes completion after reload",async()=>{
  await freshPage(async(page)=>{
    assert.equal(await page.evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
    await page.screenshot("daily-mobile");
    await page.click("הצגת התרגום");
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('יודע')).click()");
    await page.wait(page.text("סיימת סבב"),"Word stage saved");
    await page.click("להמשך התרגול");
    await page.wait(page.text("Which sentence describes yesterday?"),"Personal question stage");
    await page.clickChoice(1);
    await page.wait(page.text("נכון!"),"Personal answer saved");
    await page.click("סיום");await page.wait(page.text("סיימת את מקבץ השאלות"),"Question batch finished");
    await page.click("להמשך התרגול");await page.wait(page.text("I _____ yesterday."),"Completion stage");
    await setInput(page,"input[placeholder='Type the missing word']","went");
    await page.click("בדיקת תשובה");await page.wait(page.text("מתאים לניסוח שנלמד!"),"Completion saved");
    await page.click("סיום החזרות");await page.wait(page.text("How are you?"),"Conversation stage");
    await page.evaluate("document.querySelectorAll('button[dir=ltr]')[0].click()");
    await page.click("המשך");await page.wait(page.text("השלמת את המסלול היומי"),"Daily complete");
    assert.deepEqual(await page.evaluate("window.workflowMock.calls.map(c=>c.name)"),["mark","answer","review","conversation"]);
    assert.deepEqual(await page.evaluate("window.workflowMock.calls.find(c=>c.name==='conversation').args.slice(1)"),["everyday-workflow-dialogue",[2],"fixture-user"],"The rotated first answer saves its canonical index and rendered learner identity");
    await cdp.send("Page.reload",{},page.sessionId);await page.wait(page.text("השלמת את המסלול היומי"),"Completed stages restored");
    assert.deepEqual(await page.evaluate("window.workflowMock.calls"),[]);
    await cdp.send("Page.navigate",{url:origin+"?goal=work"},page.sessionId);
    await page.wait(page.text("הצגת התרגום"),"Changing the goal does not skip the new daily plan");
    assert.equal(await page.evaluate(page.text("אנגלית לעבודה")),true);
    await cdp.send("Page.navigate",{url:origin+"?user=other-user"},page.sessionId);
    await page.wait(page.text("הצגת התרגום"),"Other user's session has no completion state");
  });
});

test("a confirmed manual profile save starts a fresh request when editing the same preferences",async()=>{
  await freshPage(async(page)=>{
    await page.evaluate("document.querySelectorAll('input[name=placement]')[1].click()");
    await page.click("שמירת ההתאמה האישית");await page.wait(page.text("התרגול הותאם לך"),"Manual preferences saved");
    await page.click("עריכת ההעדפות");
    await page.click("שמירת ההתאמה האישית");await page.wait(page.text("התרגול הותאם לך"),"New logical save confirmed");
    const requests=await page.evaluate<{request_id:string}[]>("window.workflowMock.calls.map(c=>c.args[0])");
    assert.equal(requests.length,2);assert.notEqual(requests[0].request_id,requests[1].request_id);
  },"?mode=profile");
});

test("profile placement retains failed-save selections and retries the same request",async()=>{
  await freshPage(async(page)=>{
    await page.evaluate("document.querySelectorAll('input[name^=question-]').forEach((input,index)=>{if(index%3===0)input.click()})");
    await page.evaluate("window.workflowMock.failProfile=true");
    await page.click("שמירת ההתאמה האישית");await page.wait(page.text("השמירה לא אושרה"),"Save failure retained");
    assert.equal(await page.evaluate("document.querySelectorAll('input[name^=question-]:checked').length"),6);
    await page.click("שמירת ההתאמה האישית");await page.wait(page.text("התרגול הותאם לך"),"Placement saved");
    const requests=await page.evaluate<{request_id:string}[]>("window.workflowMock.calls.map(c=>c.args[0])");
    assert.equal(requests.length,2);assert.equal(requests[0].request_id,requests[1].request_id);
    assert.equal(await page.evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
    await page.screenshot("profile-mobile");
    await cdp.send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false},page.sessionId);
    await page.screenshot("profile-desktop");
  },"?mode=profile");
});
