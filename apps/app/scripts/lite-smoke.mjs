#!/usr/bin/env node
/**
 * Smoke test for LAWOSS-lite ↔ LAWOSS-pro over the real running Electron app,
 * driven through the control bridge (`window.__legalworkControl`) via CDP.
 * Same approach as scripts/voice-cdp.mjs: plain Node, no new dependencies.
 *
 * Usage: node scripts/lite-smoke.mjs [--cdp-url http://127.0.0.1:9223]
 * Env:   CDP_URL overrides the same way; otherwise probes 127.0.0.1:9223-9227.
 *
 * Never leaves the app in a different UI mode than it found it in (finally),
 * and never writes anything else — no chat, no memory, no files.
 */

const DEFAULT_PORTS = [9223, 9224, 9225, 9226, 9227];
const WAIT_TIMEOUT_MS = 15000;
const POLL_MS = 150;
const PROBE_TIMEOUT_MS = 1500;

const args = parseArgs(process.argv.slice(2));
const explicitCdpUrl = args.cdpUrl ?? process.env.CDP_URL ?? "";

const checks = [];

async function main() {
  let client = null;
  let originalMode = null;

  try {
    const resolved = await step("connect to a running LAWOSS app via CDP", () => resolveTarget());
    client = resolved.client;
    console.log(`Connected to ${resolved.baseUrl} (${resolved.target.url})`);

    await step("control API ready (window.__legalworkControl)", () =>
      waitFor(client, "Boolean(window.__legalworkControl)", WAIT_TIMEOUT_MS));

    originalMode = await step("read original UI mode (lawoss.lite.mode.get)", () => getMode(client));
    console.log(`Original UI mode: ${originalMode}`);

    await step("lawoss.lite.mode.set → lite", () => setMode(client, "lite"));

    await step("lawoss.lite.route.today", () => executeAction(client, "lawoss.lite.route.today"));
    await step('route.today shows [data-lawoss-lite="today"]', () =>
      waitFor(client, 'Boolean(document.querySelector(\'[data-lawoss-lite="today"]\'))', WAIT_TIMEOUT_MS));

    await step('sidebar shows [data-lawoss-lite-nav="today"]', () =>
      waitFor(client, 'Boolean(document.querySelector(\'[data-lawoss-lite-nav="today"]\'))', WAIT_TIMEOUT_MS));

    await step("sidebar hides pro-only items (Workflows/Evaluations) in lite mode", async () => {
      const probe = await evaluate(client, sidebarProbeExpression());
      assertTrue(probe.present, "sidebar ([data-slot=\"sidebar\"]) not found");
      assertTrue(!/Workflows|Evaluations/.test(probe.text), `sidebar text still mentions Workflows/Evaluations: ${probe.text.slice(0, 200)}`);
    });

    await step("lawoss.lite.route.clients", () => executeAction(client, "lawoss.lite.route.clients"));
    await step('route.clients shows [data-lawoss-lite="clients"]', () =>
      waitFor(client, 'Boolean(document.querySelector(\'[data-lawoss-lite="clients"]\'))', WAIT_TIMEOUT_MS));

    await step("lawoss.lite.mode.set → pro", () => setMode(client, "pro"));

    await step('sidebar shows [data-lawoss-nav="experiments"] (pro) and hides lite nav', async () => {
      await waitFor(client, 'Boolean(document.querySelector(\'[data-lawoss-nav="experiments"]\'))', WAIT_TIMEOUT_MS);
      const probe = await evaluate(client, sidebarProbeExpression());
      assertTrue(probe.hasExperiments, "sidebar does not show [data-lawoss-nav=\"experiments\"] in pro mode");
      assertTrue(!probe.hasLiteNavAny, "sidebar still shows a [data-lawoss-lite-nav] item in pro mode");
    });
  } catch {
    // Already recorded by step(); fall through to restore + report.
  } finally {
    if (client && originalMode) {
      await step(`restore original UI mode (${originalMode})`, () => setMode(client, originalMode)).catch(() => {});
    }
    client?.close();
  }

  return report();
}

// ---------------------------------------------------------------------------
// Steps / reporting
// ---------------------------------------------------------------------------

async function step(label, fn) {
  try {
    const value = await fn();
    checks.push({ ok: true, label });
    return value;
  } catch (error) {
    checks.push({ ok: false, label, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function report() {
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} — ${check.label}${check.error ? `: ${check.error}` : ""}`);
  }
  const passed = checks.filter((check) => check.ok).length;
  const allPassed = passed === checks.length && checks.length > 0;
  console.log(`${allPassed ? "PASS" : "FAIL"} ${passed}/${checks.length}`);
  return allPassed;
}

// ---------------------------------------------------------------------------
// LAWOSS control actions
// ---------------------------------------------------------------------------

async function getMode(client) {
  const result = await executeAction(client, "lawoss.lite.mode.get");
  const mode = result?.result?.mode;
  if (mode !== "lite" && mode !== "pro") throw new Error(`Unexpected mode.get result: ${JSON.stringify(result)}`);
  return mode;
}

async function setMode(client, mode) {
  const result = await executeAction(client, "lawoss.lite.mode.set", { mode });
  if (result?.result?.mode !== mode) throw new Error(`mode.set did not confirm "${mode}": ${JSON.stringify(result)}`);
  return result;
}

async function executeAction(client, actionId, actionArgs = undefined) {
  const expression = `window.__legalworkControl.execute(${JSON.stringify(actionId)}, ${JSON.stringify(actionArgs)})`;
  const result = await evaluate(client, expression, true);
  if (!result?.ok) throw new Error(`Control action failed: ${actionId}: ${result?.error ?? "unknown error"}`);
  return result;
}

function sidebarProbeExpression() {
  return `(() => {
    const sidebar = document.querySelector('[data-slot="sidebar"]');
    if (!sidebar) return { present: false, text: "", hasLiteNavAny: false, hasExperiments: false };
    return {
      present: true,
      text: sidebar.innerText || "",
      hasLiteNavAny: Boolean(sidebar.querySelector('[data-lawoss-lite-nav]')),
      hasExperiments: Boolean(sidebar.querySelector('[data-lawoss-nav="experiments"]')),
    };
  })()`;
}

// ---------------------------------------------------------------------------
// CDP target discovery — mirrors scripts/voice-cdp.mjs
// ---------------------------------------------------------------------------

async function resolveTarget() {
  if (explicitCdpUrl) {
    const baseUrl = explicitCdpUrl.replace(/\/$/, "");
    let list;
    try {
      list = await fetchJson(`${baseUrl}/json/list`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not reach CDP endpoint ${baseUrl}/json/list (${reason}). Is the app running with remote debugging on that port?`);
    }
    const page = pickAppPage(list) ?? (list ?? []).find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
    if (!page) throw new Error(`No CDP page target found at ${baseUrl}.`);
    const client = await connectCdp(page.webSocketDebuggerUrl);
    return { client, baseUrl, target: page };
  }

  for (const port of DEFAULT_PORTS) {
    const baseUrl = `http://127.0.0.1:${port}`;
    let list;
    try {
      list = await fetchJson(`${baseUrl}/json/list`);
    } catch {
      continue;
    }
    const page = pickAppPage(list);
    if (!page) continue;
    let client;
    try {
      client = await connectCdp(page.webSocketDebuggerUrl);
    } catch {
      continue;
    }
    const ready = await evaluate(client, "Boolean(window.__legalworkControl)").catch(() => false);
    if (ready) return { client, baseUrl, target: page };
    client.close();
  }

  throw new Error(
    `No running LAWOSS app found on 127.0.0.1 ports ${DEFAULT_PORTS.join(", ")}. ` +
    "Start the desktop app in dev mode (remote debugging is on by default), " +
    "or pass --cdp-url / set CDP_URL to point at a specific port.",
  );
}

function pickAppPage(list) {
  const pages = (list ?? []).filter((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
  return pages.find((page) => isAppUrl(page.url)) ?? null;
}

function isAppUrl(url) {
  if (typeof url !== "string") return false;
  if (url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")) return true;
  return url.startsWith("file://") && url.includes("/app-dist/index.html");
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
  return response.json();
}

// ---------------------------------------------------------------------------
// CDP plumbing — copied from scripts/voice-cdp.mjs
// ---------------------------------------------------------------------------

function connectCdp(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    let opened = false;

    const rejectPending = (error) => {
      for (const callbacks of pending.values()) callbacks.reject(error);
      pending.clear();
    };

    socket.addEventListener("open", () => {
      opened = true;
      resolve({
        close: () => socket.close(),
        send(method, params = {}) {
          const id = nextId++;
          return new Promise((innerResolve, innerReject) => {
            pending.set(id, { resolve: innerResolve, reject: innerReject });
            try {
              socket.send(JSON.stringify({ id, method, params }));
            } catch (error) {
              pending.delete(id);
              innerReject(error);
            }
          });
        },
      });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const callbacks = pending.get(message.id);
      if (!callbacks) return;
      pending.delete(message.id);
      if (message.error) callbacks.reject(new Error(message.error.message));
      else callbacks.resolve(message.result);
    });
    socket.addEventListener("error", () => {
      const error = new Error("CDP websocket failed.");
      rejectPending(error);
      if (!opened) reject(error);
    });
    socket.addEventListener("close", () => {
      const error = new Error("CDP websocket closed.");
      rejectPending(error);
      if (!opened) reject(error);
    });
  });
}

async function evaluate(client, expression, awaitPromise = false) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Evaluation failed.");
  return result.result?.value;
}

async function waitFor(client, expression, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(client, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--cdp-url") parsed.cdpUrl = values[++index];
  }
  return parsed;
}

main().then((ok) => {
  process.exit(ok ? 0 : 1);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
