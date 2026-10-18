// Isolated builtin bindings: never run the original engine or a provider.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { mock } from "node:test";

const root = process.env.HOME;
const ownedBinary = path.join(root, "inert-opencode");
fs.writeFileSync(ownedBinary, "inert: never executable");
const originals = { spawnSync: childProcess.spawnSync, spawn: childProcess.spawn,
  existsSync: fs.existsSync, createServer: net.createServer, error: console.error };
const calls = [];
let probe = () => ({ status: 0, stdout: "1.2.3\n", stderr: "" });
const spawnSyncMock = mock.method(childProcess, "spawnSync", (program, argv, options) => {
  if (program === "/usr/libexec/path_helper") return { status: 0, stdout: "", stderr: "" };
  assert.equal(program, ownedBinary, "Only the inert resolved doctor path is admitted");
  calls.push({ program, argv, options });
  return probe();
});
const spawnMock = mock.method(childProcess, "spawn", () => { throw new Error("Unexpected real child startup"); });
const serverMock = mock.method(net, "createServer", () => { throw new Error("Unexpected listener startup"); });
// Deterministic absence includes host-known locations, without changing the
// actual resolver or probing any installed binary.
const existsMock = mock.method(fs, "existsSync", (target) => /opencode[^/\\]*$/.test(String(target))
  ? false : originals.existsSync(target));
syncBuiltinESMExports();
try {
  const { createRuntimeManager } = await import("./runtime.mjs");
  assert.equal(calls.length, 0, "Import must not auto-probe");
  const createManager = (extra = {}) => createRuntimeManager({
    app: { isPackaged: false, getPath: key => key === "exe" ? path.join(root, "app", "Electron") : root },
    desktopRoot: path.join(root, "desktop"), listLocalWorkspacePaths: async () => [],
    listLocalWorkspaceAppFiles: async () => [], listLocalWorkspaces: async () => [],
    reconnectHostWorkspace: async () => null, recorder: undefined,
    onSidecarExit: () => {}, getApprovalWindow: () => null, ...extra,
  });
  const manager = createManager();
  const doctor = () => manager.engineDoctor({ opencodeBinPath: ownedBinary });
  const success = doctor();
  assert.deepEqual(calls, [
    { program: ownedBinary, argv: ["--version"], options: { encoding: "utf8", timeout: 2000, maxBuffer: 1048576, windowsHide: true } },
    { program: ownedBinary, argv: ["serve", "--help"], options: { encoding: "utf8", timeout: 2000, maxBuffer: 1048576, windowsHide: true } },
  ]);
  assert.deepEqual(success, {
    found: true, inPath: false, resolvedPath: ownedBinary, resolvedSource: "custom", version: "1.2.3",
    supportsServe: true, notes: ["Using custom: " + ownedBinary], serveHelpStatus: 0,
    serveHelpStdout: "1.2.3", serveHelpStderr: null,
  });
  calls.length = 0;
  assert.deepEqual(manager.engineDoctor(), {
    found: false, inPath: false, resolvedPath: null, resolvedSource: null, version: null,
    supportsServe: false, notes: ["OpenCode binary not found in bundled sidecars or PATH."],
    serveHelpStatus: null, serveHelpStdout: null, serveHelpStderr: null,
  });
  assert.equal(calls.length, 0, "Not-found doctor must not create a child");
  for (const failure of [
    { status: 2, stdout: "partial\n", stderr: "failure\n" },
    { status: null, stdout: "partial\n", stderr: "timeout\n", error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) },
    { status: null, stdout: "partial\n", stderr: "overflow\n", error: Object.assign(new Error("overflow"), { code: "ENOBUFS" }) },
  ]) {
    calls.length = 0;
    probe = () => failure;
    assert.deepEqual(doctor(), {
      found: true, inPath: false, resolvedPath: ownedBinary, resolvedSource: "custom", version: "partial",
      supportsServe: false,
      notes: ["Using custom: " + ownedBinary, "OpenCode version probe failed.", "OpenCode serve --help probe failed."],
      serveHelpStatus: failure.status, serveHelpStdout: "partial", serveHelpStderr: failure.stderr.trim(),
    });
    assert.equal(calls.length, 2);
  }
  const logged = [];
  console.error = (...args) => logged.push(args);
  const primary = new Error("synthetic primary startup failure");
  // Existing callback fails before port allocation, embedded import or engine
  // startup, but after the real manager has selected its doctor executable.
  const failingManager = createManager({ listLocalWorkspaceAppFiles: async () => { throw primary; } });
  for (const mode of ["nonzero", "ETIMEDOUT", "ENOBUFS", "throws"]) {
    calls.length = 0;
    logged.length = 0;
    probe = () => {
      if (mode === "throws") throw new Error("synthetic doctor exception");
      return { status: mode === "nonzero" ? 2 : null, stdout: "", stderr: "", error: Object.assign(new Error(mode), { code: mode }) };
    };
    await assert.rejects(failingManager.engineStart(root, { appFiles: "outside", opencodeBinPath: ownedBinary }), error => error === primary);
    assert.equal(calls.length, mode === "throws" ? 1 : 2, "Real engineStart catch must execute doctor");
    const diagnostics = JSON.parse(logged.find(args => args[0] === "[runtime] diagnostics:")[1]);
    assert.equal(diagnostics.lifecycleState, "error");
    assert.equal(diagnostics.engine.opencodeBinPath, ownedBinary);
    assert.equal(diagnostics.engine.running, false);
    assert.equal(diagnostics.legalworkServer.managedOpencodeBinPath, ownedBinary);
    assert.equal(diagnostics.legalworkServer.running, false);
    assert.equal(diagnostics.legalworkServer.inProcess, false);
    assert.deepEqual(Object.keys(diagnostics).sort(), ["arch", "engine", "legalworkServer", "lifecycleState", "opencode", "orchestrator", "platform"]);
    if (mode === "throws") assert.deepEqual(diagnostics.opencode, { error: "synthetic doctor exception" });
    else assert.equal(diagnostics.opencode.supportsServe, false);
  }
  console.log("doctor controls passed: import, options/argv, success, notfound/nochild, nonzero, timeout, overflow, primary identity/lifecycle for failed and throwing doctor");
} finally {
  spawnSyncMock.mock.restore();
  spawnMock.mock.restore();
  existsMock.mock.restore();
  serverMock.mock.restore();
  console.error = originals.error;
  syncBuiltinESMExports();
  assert.equal(childProcess.spawnSync, originals.spawnSync);
}
