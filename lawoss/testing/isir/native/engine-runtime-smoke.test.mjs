import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { parseRuntimeOutput, collectRuntimeProbe, syntheticRuntimeEnvironment } from "./engine-runtime-smoke.mjs";

const valid = "LAWOSS_ENGINE_RUNTIME_BUN=1.3.14\n1.18.29\n";
const unknown = outcome => ({ outcome, engineVersion: null, bunVersion: null, preloadObserved: false });

test("only the closed exact marker plus pinned version yields runtime metadata", () => {
  assert.deepEqual(parseRuntimeOutput(valid, "", 0), {
    outcome: "observed", engineVersion: "1.18.29", bunVersion: "1.3.14", preloadObserved: true,
  });
  assert.deepEqual(parseRuntimeOutput("1.18.29\r\n", "", 0), {
    outcome: "missing-preload", engineVersion: "1.18.29", bunVersion: null, preloadObserved: false,
  });
});

test("hostile, partial, non-semver, unexpected and stderr output stay content-free unknown", () => {
  for (const output of ["", valid + "secret", valid.slice(0, -1), valid.replace("1.3.14", "unknown"),
    valid.replace("1.3.14", "01.3.14"), valid.replace("1.3.14", "https://private.invalid/token"),
    valid.replace("1.18.29", "1.18.28"), valid + valid, valid.replace("1.3.14", "1.2.3" + "a".repeat(80))]) {
    assert.deepEqual(parseRuntimeOutput(output, "", 0), unknown("invalid-output"));
  }
  assert.deepEqual(parseRuntimeOutput(valid, "private stderr", 0), unknown("invalid-output"));
  assert.deepEqual(parseRuntimeOutput(valid, "", 1), unknown("child-error"));
});

function childFixture() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.exitCode = null; child.signalCode = null;
  child.kill = signal => {
    assert.equal(signal, "SIGKILL");
    child.signalCode = signal;
    queueMicrotask(() => { child.stdout.end(); child.stderr.end(); child.emit("close", null, signal); });
    return true;
  };
  return child;
}

test("owned probe waits for close and drained pipes rather than trusting exit", async t => {
  // The synthetic close-order contract uses a deterministic deadline while the
  // real event-loop turn and stream/close assertions remain unchanged.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
  const child = childFixture(), result = collectRuntimeProbe(child, 100);
  child.stdout.write(valid); child.exitCode = 0; child.emit("exit", 0, null);
  let settled = false; result.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
  t.mock.timers.tick(99); assert.equal(settled, false);
  child.stdout.end(); child.stderr.end(); child.emit("close", 0, null);
  assert.deepEqual(await result, { outcome: "observed", engineVersion: "1.18.29", bunVersion: "1.3.14", preloadObserved: true, closed: true });
  } finally { t.mock.timers.reset(); }
});

test("timeout and combined output overflow kill only the owned child then close with unknown metadata", async () => {
  for (const mode of ["timeout", "output-limit"]) {
    const child = childFixture(), result = collectRuntimeProbe(child, 10);
    if (mode === "output-limit") { child.stdout.write("x".repeat(4096)); child.stderr.write("y".repeat(4097)); }
    assert.deepEqual(await result, { ...unknown(mode), closed: true });
  }
});

test("spawn and stream errors do not retain raw errors or infer a runtime", async () => {
  const child = childFixture(), result = collectRuntimeProbe(child, 100);
  child.emit("error", new Error("private spawn details"));
  child.stdout.end(); child.stderr.end(); child.emit("close", -2, null);
  assert.deepEqual(await result, { ...unknown("child-error"), closed: true });
});

test("an exited leader is never signalled and absent close stays unknown", async () => {
  const child = childFixture(); child.exitCode = 0;
  child.kill = () => assert.fail("must not signal an exited leader");
  const result = collectRuntimeProbe(child, 10);
  child.stdout.write(valid); child.emit("exit", 0, null);
  assert.deepEqual(await result, { ...unknown("child-unclosed"), closed: false });
});

test("synthetic environment contains only owned directories, preload and the Windows loader root", () => {
  // The platform argument selects loader variables; paths always use the host's node:path.
  const root = path.resolve("synthetic"), preload = path.join(root, "preload.mjs");
  const inherited = { SystemRoot: "C:\\Windows", TOKEN: "secret", HOME: path.resolve("private") };
  const expected = {
    HOME: root, USERPROFILE: root,
    XDG_CONFIG_HOME: path.join(root, "config"), XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"),
    APPDATA: path.join(root, "appdata"), LOCALAPPDATA: path.join(root, "local"),
    TMPDIR: path.join(root, "tmp"), TMP: path.join(root, "tmp"), TEMP: path.join(root, "tmp"),
    BUN_INSPECT_PRELOAD: preload,
  };
  assert.deepEqual(syntheticRuntimeEnvironment(root, preload, "linux", inherited), expected);
  assert.deepEqual(syntheticRuntimeEnvironment(root, preload, "win32", inherited), {
    ...expected, SystemRoot: inherited.SystemRoot,
  });
  assert.throws(() => syntheticRuntimeEnvironment(root, preload, "win32", { SystemRoot: "\\\\remote\\private" }));
});
