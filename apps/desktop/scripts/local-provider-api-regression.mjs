// Mounted production modal only. Never import desktop startup or use an installed app/profile.
// node apps/desktop/scripts/local-provider-api-regression.mjs
// Optional: LEGALWORK_ELECTRON_BINARY, LEGALWORK_LOCAL_PROVIDER_TEST_OUTPUT (existing directory).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = fileURLToPath(import.meta.url);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!process.versions.electron) {
  const appRoot = fileURLToPath(new URL("../../app/", import.meta.url));
  const appRequire = createRequire(path.join(appRoot, "package.json"));
  const binary = await realpath(process.env.LEGALWORK_ELECTRON_BINARY ?? createRequire(import.meta.url)("electron"));
  await access(binary);
  const outputParent = path.resolve(process.env.LEGALWORK_LOCAL_PROVIDER_TEST_OUTPUT ?? os.tmpdir());
  assert.ok((await stat(outputParent)).isDirectory(), "Screenshot output parent must already exist");
  const { build } = appRequire("esbuild");
  const fixture = await build({
    entryPoints: [path.join(appRoot, "tests/fixtures/local-provider-api.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    tsconfig: path.join(appRoot, "tsconfig.json"),
    define: { "import.meta.env": "{}", "import.meta.hot": "undefined", "process.env.NODE_ENV": '"production"' },
    loader: { ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl", ".svg": "dataurl", ".css": "empty" },
    logLevel: "silent",
  });
  // Compile the real app CSS, without running the app build or writing to dist.
  const { build: buildCss } = await import(pathToFileURL(appRequire.resolve("vite")).href);
  const { default: tailwindcss } = await import(pathToFileURL(appRequire.resolve("@tailwindcss/vite")).href);
  const cssBuild = await buildCss({
    configFile: false, root: appRoot, plugins: [tailwindcss()], logLevel: "error",
    build: { write: false, rollupOptions: { input: path.join(appRoot, "src/app/index.css") } },
  });
  const assets = new Map(cssBuild.output.filter(item => item.type === "asset").map(item => [`/${item.fileName}`, item.source]));
  const styles = [...assets.keys()].filter(name => name.endsWith(".css"));
  assert.ok(styles.length, "App stylesheet must compile");
  const output = await mkdtemp(path.join(outputParent, "local-provider-api-"));
  const profile = await mkdtemp(path.join(output, "profile-"));
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript"); response.end(fixture.outputFiles[0].contents);
    } else if (assets.has(request.url)) {
      response.setHeader("Content-Type", request.url.endsWith(".css") ? "text/css" : "application/octet-stream");
      response.end(assets.get(request.url));
    } else if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width, initial-scale=1">${styles.map(name => `<link rel="stylesheet" href="${name}">`).join("")}</head><body class="bg-background"><script src="/fixture.js"></script></body></html>`);
    } else { response.writeHead(404); response.end(); }
  });
  try {
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const child = spawn(binary, [script, `--user-data-dir=${profile}`], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: undefined,
        LEGALWORK_LOCAL_PROVIDER_PROFILE: profile, LEGALWORK_LOCAL_PROVIDER_OUTPUT: output,
        LEGALWORK_LOCAL_PROVIDER_URL: `http://127.0.0.1:${server.address().port}` },
      stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
    });
    let log = "";
    const collect = chunk => { log = (log + chunk).slice(-32_768); };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    const timeout = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    }, 60_000);
    let code, signal;
    try { [code, signal] = await once(child, "close"); }
    finally { clearTimeout(timeout); }
    assert.equal(code, 0, `Electron regression failed (${signal ?? code}): ${log}`);
    console.log(log.trim());
    console.log(`CSS: compiled ${path.join(appRoot, "src/app/index.css")} using Vite + Tailwind (in memory)`);
    console.log(`Artifacts: ${output}`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
} else {
  const { app, BrowserWindow } = await import("electron");
  const profile = process.env.LEGALWORK_LOCAL_PROVIDER_PROFILE;
  const output = process.env.LEGALWORK_LOCAL_PROVIDER_OUTPUT;
  assert.ok(profile && output && path.dirname(profile) === output, "Requires runner-owned temporary profile");
  app.setName("Local Provider API Regression");
  app.setPath("userData", profile); app.setPath("sessionData", profile);
  app.setPath("logs", profile); app.setPath("crashDumps", profile);
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
  app.on("window-all-closed", () => {});
  let window;
  app.whenReady().then(async () => {
    const results = [], errors = [], blocked = [];
    window = new BrowserWindow({ show: false, focusable: false, width: 1000, height: 900,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    // Even the synthetic loopback model endpoints must never receive a request.
    const origin = process.env.LEGALWORK_LOCAL_PROVIDER_URL;
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith(`${origin}/`) || details.url.startsWith("data:");
      if (!allowed) blocked.push(details.url);
      callback({ cancel: !allowed });
    });
    const evaluate = expression => window.webContents.executeJavaScript(expression);
    const waitFor = async expression => {
      const deadline = Date.now() + 5000;
      do { if (await evaluate(expression)) return; await delay(20); } while (Date.now() < deadline);
      throw new Error(`Timed out: ${expression}`);
    };
    const button = label => `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)}) || [...b.querySelectorAll('div,span')].some(e => e.textContent.trim() === ${JSON.stringify(label)}))`;
    const click = async expression => {
      const point = await evaluate(`(() => {
        const element = ${expression};
        if (!element || element.disabled) throw new Error('Missing/enabled target: ' + ${JSON.stringify(expression)});
        element.scrollIntoView({ block: 'center' });
        const r = element.getBoundingClientRect(), x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
        if (!element.contains(document.elementFromPoint(x, y))) throw new Error('Target is clipped or covered');
        return { x, y };
      })()`);
      window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
      window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
      await delay(40);
    };
    const fillBaseURL = async value => {
      await evaluate(`(() => {
        const input = [...document.querySelectorAll('[role="dialog"] label')].find(l => l.textContent.trim() === 'Base URL').querySelector('input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await waitFor(`[...document.querySelectorAll('[role="dialog"] input')].some(i => i.value === ${JSON.stringify(value)})`);
    };
    const setup = async (baseURL, chatCompletionsOnly = false, providerId = "synthetic-provider") => {
      await evaluate(`window.localProviderApiFixture.setup(${JSON.stringify(baseURL) ?? "undefined"}, ${chatCompletionsOnly}, ${JSON.stringify(providerId)})`);
      await waitFor(`Boolean(${button(baseURL === undefined ? "Local model" : "Chat Completions")})`);
      await delay(250);
    };
    // Production uses visual active classes rather than aria-pressed on these buttons.
    const selected = label => evaluate(`Boolean(${button(label)}?.classList.contains('border-[rgba(var(--dls-accent-rgb),0.4)]'))`);
    const assertChatOnly = async () => {
      assert.equal(await evaluate(`Boolean(${button("Responses API")})`), false, "Responses must be absent, not merely hidden");
      assert.equal(await selected("Chat Completions"), true, "Chat Completions must be selected");
    };
    const screenshot = async name => {
      await evaluate(`${button("Chat Completions")}.scrollIntoView({ block: 'center' })`);
      await delay(250);
      const layout = await evaluate(`(() => {
        const dialog = document.querySelector('[role="dialog"]'), api = ${button("Chat Completions")};
        const r = dialog.getBoundingClientRect(), a = api.getBoundingClientRect();
        return { fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
          apiVisible: a.top >= r.top && a.bottom <= r.bottom, styled: getComputedStyle(dialog).position === 'fixed' };
      })()`);
      assert.deepEqual(layout, { fits: true, apiVisible: true, styled: true });
      await writeFile(path.join(output, name), (await window.webContents.capturePage()).toPNG());
    };
    const submit = async (label, apiType, baseURL, providerId) => {
      await click(button(label));
      await waitFor("window.localProviderApiFixture.state().closes === 1");
      const state = await evaluate("window.localProviderApiFixture.state()");
      assert.equal(state.submissions.length, 1);
      const payload = state.submissions[0];
      assert.equal(payload.apiType, apiType); assert.equal(payload.baseURL, baseURL);
      assert.equal(payload.providerId, providerId); assert.equal(payload.apiKey, "");
      assert.deepEqual(payload.models.map(model => model.id), ["qwen2.5:fixture"]);
      return state;
    };
    await window.loadURL(origin);
    await waitFor("Boolean(window.localProviderApiFixture)");
    await evaluate("document.fonts.ready");

    await setup("", true); await assertChatOnly();
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes('11434')`), false);
    await screenshot("redacted-custom-id-desktop.png");
    const redacted = await submit("Save changes", "chat", "", "synthetic-provider");
    assert.equal(redacted.submissions[0].preserveExistingEndpoint, true);
    results.push("redacted custom-ID local endpoint: Responses absent, Chat selected, submits chat and preserves private endpoint");

    await setup("", true);
    await fillBaseURL("https://example.invalid/v1");
    assert.equal(await selected("Responses API"), true, "A replacement remote URL must not inherit the saved endpoint's classification");
    await submit("Save changes", "responses", "https://example.invalid/v1", "synthetic-provider");
    results.push("remote replacement: saved local classification does not constrain the replacement URL");

    await setup("");
    assert.equal(await selected("Responses API"), true, "A redacted remote endpoint must retain Responses");
    const remoteRedacted = await submit("Save changes", "responses", "", "synthetic-provider");
    assert.equal(remoteRedacted.submissions[0].preserveExistingEndpoint, true);
    results.push("redacted remote custom-ID endpoint: Responses retained and private endpoint preserved");

    await setup("", false, "ollama");
    assert.equal(await selected("Responses API"), true, "A saved provider ID alone must not classify a redacted endpoint");
    await submit("Save changes", "responses", "", "ollama");
    results.push("redacted remote provider named ollama: provider ID alone does not force Chat Completions");

    for (const baseURL of ["http://127.0.0.1:11434/v1", "http://localhost:11434/v1", "http://[::1]:11434/v1"]) {
      await setup(baseURL); await assertChatOnly();
      if (baseURL.includes("127.0.0.1")) await screenshot("stale-loopback-desktop.png");
      await submit("Save changes", "chat", baseURL, "synthetic-provider");
      results.push(`stale Responses edit ${baseURL}: Responses absent, Chat selected, submits chat`);
    }
    window.setContentSize(390, 844);
    await setup("http://127.0.0.1:11434/v1"); await assertChatOnly();
    await screenshot("stale-loopback-mobile.png");
    await submit("Save changes", "chat", "http://127.0.0.1:11434/v1", "synthetic-provider");
    results.push("390x844 mobile: API control and dialog fit; stale edit submits chat");
    window.setContentSize(1000, 900);

    for (const [label, providerId] of [["llama.cpp", "llama-cpp"], ["vLLM", "vllm"], ["LocalAI", "localai"], ["Ollama", "ollama"], ["LM Studio", "lm-studio"]]) {
      await setup(); await click(button("Local model"));
      await waitFor(`Boolean(${button(label)})`); await click(button(label));
      await assertChatOnly();
      // Prove the selected template guard independently of the recognized loopback URL.
      await fillBaseURL("https://example.invalid/v1"); await assertChatOnly();
      await click(button("Load models"));
      await waitFor('Boolean(document.querySelector(\'[role="dialog"] [role="checkbox"]\'))');
      await click('document.querySelector(\'[role="dialog"] [role="checkbox"]\')');
      if (label === "Ollama") await screenshot("ollama-template-desktop.png");
      const state = await submit("Add provider", "chat", "https://example.invalid/v1", providerId);
      assert.deepEqual(state.fetches, ["https://example.invalid/v1"]);
      results.push(`${label} selected template: Responses absent, Chat selected, submits chat even with generic URL`);
    }

    await setup("https://example.invalid/v1");
    assert.equal(await evaluate(`Boolean(${button("Responses API")})`), true);
    assert.equal(await selected("Responses API"), true);
    await click(button("Chat Completions")); assert.equal(await selected("Chat Completions"), true);
    assert.equal(await selected("Responses API"), false);
    await click(button("Responses API")); assert.equal(await selected("Responses API"), true);
    assert.equal(await selected("Chat Completions"), false);
    await screenshot("generic-responses-desktop.png");
    await submit("Save changes", "responses", "https://example.invalid/v1", "synthetic-provider");
    results.push("generic HTTPS: Responses retained, both API options selectable, submits responses");
    assert.deepEqual(errors, [], "Renderer console errors");
    assert.deepEqual(blocked, [], "Unexpected network requests");
    for (const result of results) console.log(`PASS ${result}`);
    await writeFile(path.join(output, "results.json"), JSON.stringify({ electron: process.versions.electron, results, rendererErrors: errors, blockedRequests: blocked }, null, 2));
    window.destroy(); app.quit();
  }).catch(error => {
    console.error(error.stack);
    if (window && !window.isDestroyed()) window.destroy();
    app.exit(1);
  });
}
