import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { alphaStartupPhases, createAlphaStartupCheckpoints } from './lawoss-startup-checkpoints.mjs';
import { installMainErrorLog, logWindowErrors } from "./main-error-log.mjs";
import { buildSupportBundleText } from "./support-bundle.mjs";

// Installs the log over silent console stubs so test output stays clean, then
// restores the real console and stack limit.
function withMainErrorLog(run) {
  const logsDir = mkdtempSync(path.join(os.tmpdir(), "legalwork-main-log-"));
  const { error, warn } = console;
  const { stackTraceLimit } = Error;
  console.error = () => {};
  console.warn = () => {};
  try {
    installMainErrorLog(() => logsDir);
    run(logsDir);
  } finally {
    console.error = error;
    console.warn = warn;
    Error.stackTraceLimit = stackTraceLimit;
    rmSync(logsDir, { recursive: true, force: true });
  }
}

describe("installMainErrorLog", () => {
  it("keeps an embedded-server route failure, with its stack, for the support bundle", () => {
    withMainErrorLog((logsDir) => {
      // Past the old 64 KB bundle tail, so the bundle must carry main.log whole.
      console.warn("first entry", "y".repeat(100_000));
      const failure = new Error("Nested mappings are not allowed in compact mappings");
      // The call server.ts makes when a route throws something that is not an ApiError.
      console.error("[legalwork-server] Unhandled error:", "GET", "/workspace/ws_1/skills/client-update", failure);

      const log = readFileSync(path.join(logsDir, "main.log"), "utf8");
      assert.match(log, /ERROR \[legalwork-server\] Unhandled error: GET \/workspace\/ws_1\/skills\/client-update Error: Nested mappings/);
      assert.ok(log.includes(failure.stack.split("\n")[1].trim()), "stack frames are kept");

      const bundle = buildSupportBundleText({
        app: { getName: () => "LegalWork", getVersion: () => "0.0.0", isPackaged: true, getPath: () => logsDir },
        runtimeManager: { collectRuntimeDiagnostics: () => ({}) },
      });
      assert.match(bundle, /Log file: main\.log/);
      assert.match(bundle, /WARN first entry y{100000}\n/);
      assert.match(bundle, /\[legalwork-server\] Unhandled error: GET \/workspace\/ws_1\/skills\/client-update Error: Nested mappings/);
    });
  });

  it("keeps deep stacks, nested details and long strings whole", () => {
    withMainErrorLog((logsDir) => {
      // 15 distinct frames: past node's default of 10 (recursion would print
      // as one collapsed line).
      let call = () => new Error("created 15 calls deep");
      for (let index = 0; index < 15; index += 1) {
        const inner = call;
        call = { [`frame${index}`]: () => inner() }[`frame${index}`];
      }
      const failure = Object.assign(call(), {
        details: { a: { b: { c: { d: "detail at depth 4" } } } },
        body: `${"z".repeat(12_000)}END`,
      });
      console.error("[skills] failure:", failure);

      const log = readFileSync(path.join(logsDir, "main.log"), "utf8");
      for (let index = 0; index < 15; index += 1) assert.match(log, new RegExp(`at frame${index} `));
      assert.match(log, /detail at depth 4/);
      assert.match(log, /z{12000}END/);
    });
  });

  it("rotates main.log to main.old.log once it passes the size cap", () => {
    withMainErrorLog((logsDir) => {
      const filler = "x".repeat(100_000);
      for (let index = 0; index < 11; index += 1) console.warn(`entry-${index}`, filler);

      const current = readFileSync(path.join(logsDir, "main.log"), "utf8");
      const previous = readFileSync(path.join(logsDir, "main.old.log"), "utf8");
      assert.match(current, /WARN entry-10 /);
      assert.doesNotMatch(current, /entry-9 /);
      assert.match(previous, /WARN entry-9 /);
    });
  });
});

describe("buildSupportBundleText", () => {
  it("says how this machine reaches GitHub", () => {
    withMainErrorLog((logsDir) => {
      const bundle = buildSupportBundleText({
        app: { getName: () => "LegalWork", getVersion: () => "0.0.0", isPackaged: true, getPath: () => logsDir },
        runtimeManager: { collectRuntimeDiagnostics: () => ({}) },
        network: { systemProxyForGithub: "PROXY proxy.firm.local:8080", proxyEnv: {} },
      });
      assert.match(bundle, /========== Network ==========\n\{\n {2}"systemProxyForGithub": "PROXY proxy\.firm\.local:8080"/);
    });
  });
});

describe("logWindowErrors", () => {
  it("keeps an app window's console warnings, errors and crashes", () => {
    withMainErrorLog((logsDir) => {
      const contents = new EventEmitter();
      logWindowErrors(contents);
      contents.emit("console-message", {
        level: "warning",
        message: "[legalwork-server] POST http://127.0.0.1:5000/workspace/ws_1/github-skills/scan failed after 10002ms: Request timed out.",
        lineNumber: 12,
        sourceId: "app.js",
      });
      contents.emit("console-message", { level: "info", message: "chatty", lineNumber: 1, sourceId: "app.js" });
      contents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 5 });

      const log = readFileSync(path.join(logsDir, "main.log"), "utf8");
      assert.match(log, /WARN \[window\] \[legalwork-server\] POST \S+\/github-skills\/scan failed after 10002ms: Request timed out\. \(app\.js:12\)/);
      assert.doesNotMatch(log, /chatty/);
      assert.match(log, /ERROR \[window\] Renderer process gone: \{ reason: 'crashed', exitCode: 5 \}/);
    });
  });
});

it('startup observations require the explicit isolated Windows alpha opt-in', () => {
  const messages = [];
  for (const input of [
    { platform: 'darwin', optIn: '1', isolated: true },
    { platform: 'linux', optIn: '1', isolated: true },
    { platform: 'win32', optIn: 'true', isolated: true },
    { platform: 'win32', optIn: '1', isolated: false },
  ]) createAlphaStartupCheckpoints({ ...input, write: value => messages.push(value) })('main-configured');
  assert.deepEqual(messages, []);
});

it('startup observations are finite exact phases, once each, and never serialize caller data', () => {
  const messages = [];
  const checkpoint = createAlphaStartupCheckpoints({ platform: 'win32', optIn: '1', isolated: true, write: value => messages.push(value) });
  checkpoint('main-configured'); checkpoint('ready-entered'); checkpoint('ready-entered');
  checkpoint('actaport-environment-entered'); checkpoint('actaport-environment-returned');
  checkpoint('PRIVATE /profile token=secret'); checkpoint({ toString() { throw new Error('private'); } });
  assert.deepEqual(messages, ['[lawoss-alpha-startup] main-configured', '[lawoss-alpha-startup] ready-entered',
    '[lawoss-alpha-startup] actaport-environment-entered', '[lawoss-alpha-startup] actaport-environment-returned']);
});

it('a failed diagnostic writer cannot replace application control flow or retry a phase', () => {
  let calls = 0;
  const checkpoint = createAlphaStartupCheckpoints({ platform: 'win32', optIn: '1', isolated: true, write: () => { calls++; throw new Error('private'); } });
  assert.doesNotThrow(() => { checkpoint('ui-control-entered'); checkpoint('ui-control-entered'); });
  assert.equal(calls, 1);
});

it('pre-ready checkpoints distinguish completed module initialization from lock refusal and callback registration', () => {
  const messages = [];
  const checkpoint = createAlphaStartupCheckpoints({ platform: 'win32', optIn: '1', isolated: true, write: value => messages.push(value) });
  checkpoint('icons-entered'); checkpoint('icons-returned'); checkpoint('services-returned');
  checkpoint('runtime-manager-returned'); checkpoint('single-instance-entered');
  checkpoint('single-instance-rejected'); checkpoint('single-instance-acquired');
  checkpoint('ready-registering'); checkpoint('ready-registered');
  assert.deepEqual(messages, [
    '[lawoss-alpha-startup] icons-entered', '[lawoss-alpha-startup] icons-returned',
    '[lawoss-alpha-startup] services-returned', '[lawoss-alpha-startup] runtime-manager-returned',
    '[lawoss-alpha-startup] single-instance-entered', '[lawoss-alpha-startup] single-instance-rejected',
    '[lawoss-alpha-startup] single-instance-acquired', '[lawoss-alpha-startup] ready-registering',
    '[lawoss-alpha-startup] ready-registered',
  ]);
});

it('runtime constructor checkpoint phases are fixed once-only observations within the 32-write limit', () => {
  const phases = ['runtime-manager-entered', 'runtime-state-returned', 'runtime-user-data-returned',
    'runtime-home-returned', 'runtime-documents-returned', 'runtime-sidecars-returned', 'runtime-office-returned'];
  const messages = [];
  const checkpoint = createAlphaStartupCheckpoints({ platform: 'win32', optIn: '1', isolated: true, write: value => messages.push(value) });
  for (const phase of phases) { checkpoint(phase); checkpoint(phase); }
  assert.deepEqual(messages, phases.map(phase => `[lawoss-alpha-startup] ${phase}`));
  for (const phase of alphaStartupPhases) { checkpoint(phase); checkpoint(phase); }
  checkpoint('PRIVATE /profile token=secret'); checkpoint({ toString() { throw new Error('private'); } });
  assert.equal(alphaStartupPhases.length, 32);
  assert.equal(Object.isFrozen(alphaStartupPhases), true);
  assert.equal(messages.length, 32);
  assert.equal(new Set(messages).size, 32);
});

it('runtime constructor checkpoints use the existing physical main log without private caller data', () => {
  withMainErrorLog(logsDir => {
    const checkpoint = createAlphaStartupCheckpoints({ platform: 'win32', optIn: '1', isolated: true, write: line => console.warn(line) });
    const phases = ['runtime-manager-entered', 'runtime-state-returned', 'runtime-user-data-returned',
      'runtime-home-returned', 'runtime-documents-returned', 'runtime-sidecars-returned', 'runtime-office-returned'];
    for (const phase of phases) { checkpoint(phase); checkpoint(phase); }
    checkpoint('runtime-documents-returned PRIVATE');
    const log = readFileSync(path.join(logsDir, 'main.log'), 'utf8');
    assert.deepEqual(log.trim().split('\n').map(line => line.replace(/^\[[^\]]+\] WARN /, '')),
      phases.map(phase => `[lawoss-alpha-startup] ${phase}`));
    assert.doesNotMatch(log, /PRIVATE/);
  });
});
