import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PINNED_ENGINE_VERSION, prepareNativeEngineFiles, verifyNativeEngineFiles } from "./engine-identity.mjs";

const marker = "LAWOSS_ENGINE_RUNTIME_BUN=";
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
const unknown = outcome => ({ outcome, engineVersion: null, bunVersion: null, preloadObserved: false });

// Exact complete lines only: incidental log/version fragments confer no identity.
export function parseRuntimeOutput(stdout, stderr, code) {
  if (code !== 0) return unknown("child-error");
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 8192) return unknown("output-limit");
  if (stderr) return unknown("invalid-output");
  const lines = stdout.replace(/\r\n/g, "\n").split("\n");
  if (lines.length === 2 && lines[0] === PINNED_ENGINE_VERSION && lines[1] === "") {
    return { ...unknown("missing-preload"), engineVersion: PINNED_ENGINE_VERSION };
  }
  if (lines.length !== 3 || lines[1] !== PINNED_ENGINE_VERSION || lines[2] !== "" || !lines[0].startsWith(marker)) return unknown("invalid-output");
  const bunVersion = lines[0].slice(marker.length);
  if (bunVersion.length > 64 || !semver.test(bunVersion)) return unknown("invalid-output");
  return { outcome: "observed", engineVersion: PINNED_ENGINE_VERSION, bunVersion, preloadObserved: true };
}

// No shell, numeric PID/group signal or process-table inspection. close, unlike
// exit, proves that the owned CLI and its captured output pipes have closed.
export function collectRuntimeProbe(child, timeoutMs = 5000) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 5000);
  return new Promise(resolve => {
    let stdout = [], stderr = [], bytes = 0, failure, drainTimer, settled = false;
    const finish = (closed, code) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(drainTimer);
      const result = !closed ? unknown("child-unclosed") : failure ? unknown(failure)
        : parseRuntimeOutput(Buffer.concat(stdout).toString("utf8"), Buffer.concat(stderr).toString("utf8"), code);
      stdout = []; stderr = [];
      resolve({ ...result, closed });
    };
    const stop = outcome => {
      if (failure || settled) return;
      failure = outcome; stdout = []; stderr = [];
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill("SIGKILL"); } catch { /* The close event remains required. */ }
      }
      drainTimer = setTimeout(() => {
        finish(false, null);
        child.stdout?.destroy(); child.stderr?.destroy();
        child.unref?.();
      }, 1000);
    };
    const capture = target => chunk => {
      if (failure || settled) return;
      bytes += chunk.length;
      if (bytes > 8192) return stop("output-limit");
      target.push(Buffer.from(chunk));
    };
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    child.stdout.on("data", capture(stdout)); child.stderr.on("data", capture(stderr));
    child.stdout.on("error", () => stop("child-error")); child.stderr.on("error", () => stop("child-error"));
    child.on("error", () => stop("child-error"));
    child.once("close", code => finish(true, code));
  });
}

export function syntheticRuntimeEnvironment(root, preload, platform = process.platform, inherited = process.env) {
  const env = {
    HOME: root, USERPROFILE: root,
    XDG_CONFIG_HOME: path.join(root, "config"), XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"),
    APPDATA: path.join(root, "appdata"), LOCALAPPDATA: path.join(root, "local"),
    TMPDIR: path.join(root, "tmp"), TMP: path.join(root, "tmp"), TEMP: path.join(root, "tmp"),
    BUN_INSPECT_PRELOAD: preload,
  };
  if (platform === "win32") {
    assert.match(inherited.SystemRoot ?? inherited.SYSTEMROOT ?? "", /^[a-z]:\\Windows$/i);
    env.SystemRoot = inherited.SystemRoot ?? inherited.SYSTEMROOT;
  }
  return env;
}

export async function runEngineRuntimeSmoke(bundleDir) {
  const started = performance.now();
  let root, prepared, closed = true, result = unknown("identity-failed"), engineSha256 = null;
  try {
    // No external fixture fallback: select the same platform-target-first bytes
    // and current manifests as the ordinary native gate, without provisioning.
    prepared = await prepareNativeEngineFiles({ bundleDir });
    await verifyNativeEngineFiles(prepared, prepared.path);
    engineSha256 = prepared.expectedHash;
    root = await mkdtemp(path.join(tmpdir(), "lawoss-engine-runtime-"));
    const preload = path.join(root, "preload.mjs"), env = syntheticRuntimeEnvironment(root, preload);
    for (const directory of new Set(Object.values(env).filter(value => value !== preload && value !== env.SystemRoot))) await mkdir(directory, { recursive: true });
    await writeFile(preload, `const v = Bun.version; console.log(${JSON.stringify(marker)} + (typeof v === "string" && v.length <= 64 && ${semver}.test(v) ? v : "unknown"));\n`, { flag: "wx" });
    const child = spawn(prepared.path, ["--version"], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    closed = false;
    const probe = await collectRuntimeProbe(child);
    closed = probe.closed;
    result = probe;
  } catch {
    result = unknown("identity-failed"); engineSha256 = null;
  } finally {
    if (prepared) {
      try { await verifyNativeEngineFiles(prepared, prepared.path); }
      catch { result = unknown("identity-failed"); engineSha256 = null; }
    }
    // Never delete an active/unobserved child's synthetic tree. An unclosed
    // child is explicit unknown; ordinary close always permits owned cleanup.
    if (root && closed) {
      try { await rm(root, { recursive: true, force: true }); }
      catch { result = unknown("cleanup-failed"); }
    }
  }
  return {
    schemaVersion: 1, status: result.outcome === "observed" ? "observed" : "unknown", outcome: result.outcome,
    engineVersion: result.engineVersion, engineSha256, bunVersion: result.bunVersion,
    preloadObserved: result.preloadObserved, elapsedMs: Math.round(performance.now() - started),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    assert.equal(process.versions.node.split(".")[0], "24");
    assert.ok(process.argv[2] && path.isAbsolute(process.argv[2]));
    const bundleDir = process.argv[3] ?? fileURLToPath(new URL("../../../../apps/desktop/resources/sidecars/", import.meta.url));
    const receipt = await runEngineRuntimeSmoke(bundleDir);
    await writeFile(process.argv[2], `${JSON.stringify(receipt)}\n`, { flag: "wx" });
    process.exitCode = receipt.status === "observed" ? 0 : 1;
  } catch { process.stderr.write("Engine runtime smoke could not produce its allowlisted receipt.\n"); process.exitCode = 1; }
}
