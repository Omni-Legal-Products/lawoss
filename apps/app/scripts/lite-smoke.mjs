#!/usr/bin/env node
/**
 * Smoke test for LAWOSS-lite ↔ LAWOSS-pro over the real running Electron app,
 * driven through the control bridge (`window.__legalworkControl`) via CDP.
 * Same approach as scripts/voice-cdp.mjs: plain Node, no new dependencies.
 *
 * Usage: node scripts/lite-smoke.mjs [--cdp-url http://127.0.0.1:9223]
 * Env:   CDP_URL overrides the same way; otherwise probes 127.0.0.1:9223-9227.
 *
 * Never leaves the app in a different UI mode than it found it in — restored
 * both on normal completion and on SIGINT/SIGTERM, through a single guarded
 * restore path (see `createModeRestoreGuard`) so the two can't double-restore
 * or race on the exit code. Never writes anything else — no chat, no memory,
 * no files.
 */

const DEFAULT_PORTS = [9223, 9224, 9225, 9226, 9227];
const WAIT_TIMEOUT_MS = 15000;
const POLL_MS = 150;
const PROBE_TIMEOUT_MS = 1500;
const RESTORE_TIMEOUT_MS = 5000;

const args = parseArgs(process.argv.slice(2));
const explicitCdpUrl = args.cdpUrl ?? process.env.CDP_URL ?? "";

const checks = [];

// ---------------------------------------------------------------------------
// Single-restore guard, shared by the normal `finally` path and the signal
// handlers below, so a SIGINT/SIGTERM arriving mid-run restores the original
// mode at most once — never twice, never racing the normal exit.
// ---------------------------------------------------------------------------

let activeClient = null;
let originalUiMode = null;

const restoreOriginalModeOnce = createModeRestoreGuard({
  getClient: () => activeClient,
  getOriginalMode: () => originalUiMode,
  restore: (client, mode) => setMode(client, mode),
  timeoutMs: RESTORE_TIMEOUT_MS,
});

/** Pure factory so the once-only + bounded behavior is unit-testable without CDP. */
export function createModeRestoreGuard({ getClient, getOriginalMode, restore, timeoutMs }) {
  let promise = null;
  return function restoreOnce() {
    if (!promise) {
      promise = (async () => {
        const client = getClient();
        const mode = getOriginalMode();
        if (!client || !mode) return { attempted: false };
        try {
          await withTimeout(restore(client, mode), timeoutMs, "restore mode timed out");
          return { attempted: true, ok: true };
        } catch (error) {
          return { attempted: true, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      })();
    }
    return promise;
  };
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let exitCode = null;
/** Guards `process.exit` itself so the normal-completion path and a signal handler can't both decide the exit code. */
function exitOnce(code) {
  if (exitCode !== null) return;
  exitCode = code;
  process.exit(code);
}

async function handleSignal(signal, code) {
  console.log(`\n${signal} received — restoring original UI mode (bounded, ≤${RESTORE_TIMEOUT_MS}ms) before exit…`);
  const outcome = await restoreOriginalModeOnce();
  if (outcome.attempted) {
    console.log(outcome.ok ? "Restored original UI mode." : `Failed to restore original UI mode: ${outcome.error}`);
  } else {
    console.log("Nothing to restore (mode was not read/changed yet).");
  }
  exitOnce(code);
}


async function main() {
  try {
    const resolved = await step("connect to a running LAWOSS app via CDP", () => resolveTarget());
    activeClient = resolved.client;
    console.log(`Connected to ${resolved.baseUrl} (${resolved.target.url})`);

    await step("control API ready (window.__legalworkControl)", () =>
      waitFor(activeClient, "Boolean(window.__legalworkControl)", WAIT_TIMEOUT_MS));

    originalUiMode = await step("read original UI mode (lawoss.lite.mode.get)", () => getMode(activeClient));
    console.log(`Original UI mode: ${originalUiMode}`);

    await step("lawoss.lite.mode.set → lite", () => setMode(activeClient, "lite"));

    await step("lawoss.lite.route.today", () => executeAction(activeClient, "lawoss.lite.route.today"));
    await step('route.today shows [data-lawoss-lite="today"]', () =>
      waitFor(activeClient, 'Boolean(document.querySelector(\'[data-lawoss-lite="today"]\'))', WAIT_TIMEOUT_MS));

    await step("sidebar reflects lite mode (today nav present, experiments marker absent)", async () => {
      const probe = await evaluate(activeClient, sidebarProbeExpression());
      assertTrue(probe.present, 'sidebar ([data-slot="sidebar"]) not found');
      assertTrue(probe.hasLiteToday, 'sidebar does not show [data-lawoss-lite-nav="today"] in lite mode');
      assertTrue(!probe.hasExperiments, 'sidebar still shows [data-lawoss-nav="experiments"] in lite mode');
    });

    await step("lawoss.lite.route.clients", () => executeAction(activeClient, "lawoss.lite.route.clients"));
    await step('route.clients shows [data-lawoss-lite="clients"]', () =>
      waitFor(activeClient, 'Boolean(document.querySelector(\'[data-lawoss-lite="clients"]\'))', WAIT_TIMEOUT_MS));

    await step("lawoss.lite.mode.set → pro", () => setMode(activeClient, "pro"));

    await step("sidebar reflects pro mode (experiments marker present, lite nav absent)", async () => {
      await waitFor(activeClient, 'Boolean(document.querySelector(\'[data-lawoss-nav="experiments"]\'))', WAIT_TIMEOUT_MS);
      const probe = await evaluate(activeClient, sidebarProbeExpression());
      assertTrue(probe.hasExperiments, 'sidebar does not show [data-lawoss-nav="experiments"] in pro mode');
      assertTrue(!probe.hasLiteNavAny, "sidebar still shows a [data-lawoss-lite-nav] item in pro mode");
    });
  } catch {
    // Already recorded by step(); fall through to restore + report.
  } finally {
    if (activeClient && originalUiMode) {
      await step(`restore original UI mode (${originalUiMode})`, async () => {
        const outcome = await restoreOriginalModeOnce();
        if (outcome.attempted && !outcome.ok) throw new Error(outcome.error);
      }).catch(() => {});
    }
    activeClient?.close();
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

/**
 * Locale-independent: checks structural `data-*` markers only (no sidebar
 * text/word matching — the app renders in Czech/Slovak/English depending on
 * the user's locale, so "Workflows"/"Evaluations" would never match a
 * Czech-locale run and the check would pass vacuously).
 */
function sidebarProbeExpression() {
  return `(() => {
    const sidebar = document.querySelector('[data-slot="sidebar"]');
    if (!sidebar) return { present: false, hasLiteToday: false, hasLiteNavAny: false, hasExperiments: false };
    return {
      present: true,
      hasLiteToday: Boolean(sidebar.querySelector('[data-lawoss-lite-nav="today"]')),
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

// Only run when executed directly (`node scripts/lite-smoke.mjs`), not when
// imported by a unit test for `createModeRestoreGuard`.
const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  // Obsluha signálů jen při přímém spuštění — import z unit testu nesmí měnit chování procesu.
  process.on("SIGINT", () => { void handleSignal("SIGINT", 130); });
  process.on("SIGTERM", () => { void handleSignal("SIGTERM", 143); });
  main().then((ok) => {
    exitOnce(ok ? 0 : 1);
  }).catch((error) => {
    console.error(error);
    exitOnce(1);
  });
}
