// LAWOSS: host-side Chevron7 CLI (API v1) for the pre-signing gate of spec 0022
// (lawOSS-like-SK-CZ specs/0022, issue #592). Only the main process calls it; the
// agent and the renderer never pass a path or read helper output. Inspect and
// validate only: nothing here signs, and no outcome is inferred from exit zero alone.
import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { findChevron7Signing, isSigningPdf } from "./lawoss-chevron7-signing.mjs";

const exec = promisify(execFile);
const HELPER = "Contents/Helpers/chevron7";
const DEFAULT_TIMEOUT = 120_000;
// Designated requirement: the bundle id alone is not proof of origin, so pin the Developer ID team of Chevron7.
export const CHEVRON7_REQUIREMENT = '=identifier "app.slovensko.chevron7" and anchor apple generic and certificate leaf[subject.OU] = "Q7AU96CW7H"';
const DEFAULT_MAX_OUTPUT = 4 * 1024 * 1024;
// API v1 exit codes that are a refusal or a failure of the call itself.
const EXIT_STATUS = { 2: "refused", 3: "unavailable", 4: "busy", 6: "timeout", 7: "file-error", 8: "failed", 9: "failed" };

/** One CLI profile per client root, without the folder name (INTEGRATIONS.md: no client names in profiles). */
export function chevron7Session(clientRoot) {
  return `lawoss-${createHash("sha256").update(path.resolve(clientRoot)).digest("hex").slice(0, 24)}`;
}

const inside = (root, file) => file.startsWith(`${root}${path.sep}`);

/** An absolute PDF inside the client root, also after resolving links; null otherwise. */
export async function resolveClientPdf(file, clientRoot) {
  if (typeof file !== "string" || typeof clientRoot !== "string" || !path.isAbsolute(file) || !path.isAbsolute(clientRoot)) return null;
  try {
    const root = await realpath(clientRoot);
    if (!(await stat(root)).isDirectory()) return null;
    const resolved = await realpath(file);
    if (!inside(root, resolved) || !await isSigningPdf(resolved)) return null;
    return { file: resolved, root };
  } catch { return null; }
}

/** The bundled helper as an executable regular file that stays inside the bundle. */
export async function findChevron7Helper(bundle) {
  const helper = path.join(bundle, HELPER);
  try {
    const canonicalBundle = await realpath(bundle);
    if ((await realpath(helper)) !== path.join(canonicalBundle, HELPER)) return null;
    await access(helper, constants.X_OK);
    return (await stat(helper)).isFile() ? helper : null;
  } catch { return null; }
}

/**
 * Runs the helper with literal argv and a minimal environment. stderr is ignored
 * (it may carry signer identity); stdout is bounded and must be one API v1 envelope.
 * @param {string} helper
 * @param {string[]} args
 * @param {{ timeout?: number, maxOutput?: number, signal?: AbortSignal }} [options]
 */
export function runChevron7Cli(helper, args, { timeout = DEFAULT_TIMEOUT, maxOutput = DEFAULT_MAX_OUTPUT, signal } = {}) {
  return new Promise(resolve => {
    // Own process group, so a timeout also stops descendants that would keep stdout open.
    const child = spawn(helper, args, { shell: false, detached: true, stdio: ["ignore", "pipe", "ignore"],
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } });
    const chunks = [];
    let size = 0;
    let reason;
    let killTimer;
    const kill = sig => { try { if (child.pid) process.kill(-child.pid, sig); } catch { /* Already gone. */ } };
    const stop = why => {
      if (reason) return;
      reason = why;
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 1500);
    };
    const timer = setTimeout(() => stop("timeout"), timeout);
    const abort = () => stop("timeout");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", chunk => {
      size += chunk.length;
      if (size > maxOutput) stop("output-limit");
      else chunks.push(chunk);
    });
    const finish = result => {
      clearTimeout(timer);
      // A stopped call leaves no descendants behind.
      if (reason) kill("SIGKILL");
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    child.once("error", () => finish({ code: null, envelope: null, reason: "spawn" }));
    child.once("close", code => {
      if (reason) return finish({ code: null, envelope: null, reason });
      try {
        const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (envelope?.apiVersion !== 1 || typeof envelope.ok !== "boolean") return finish({ code, envelope: null, reason: "incompatible" });
        finish({ code, envelope });
      } catch { finish({ code, envelope: null, reason: "incompatible" }); }
    });
  });
}

const count = value => (Number.isInteger(value) && value >= 0 ? value : null);
const isRecord = value => typeof value === "object" && value !== null && !Array.isArray(value);

/** Maps a call outcome to an error status, or null when the envelope carries a result. */
function callFailure(response, allowed) {
  if (response.reason === "timeout") return { status: "timeout" };
  if (!response.envelope) return { status: "failed" };
  if (!allowed.includes(response.code)) return { status: EXIT_STATUS[response.code] ?? "failed" };
  if (!response.envelope.ok || !isRecord(response.envelope.result)) return { status: "failed" };
  return null;
}

function inspectResult(response) {
  const failed = callFailure(response, [0]);
  if (failed) return failed;
  const { validationState, signatureCount, unverifiedDocumentCount } = response.envelope.result;
  const signatures = count(signatureCount);
  const unverified = count(unverifiedDocumentCount);
  if (typeof validationState !== "string" || signatures === null || unverified === null) return { status: "failed" };
  if (validationState === "unsigned" && signatures === 0 && unverified === 0) return { status: "unsigned" };
  // Anything not provably unsigned counts as signed: the gate must not edit or merge it.
  return { status: "signed", signatureCount: signatures, unverifiedDocumentCount: unverified };
}

function validateResult(response) {
  const failed = callFailure(response, [0, 10]);
  if (failed) return failed;
  const { validationState, signatureCount } = response.envelope.result;
  const signatures = count(signatureCount);
  if (typeof validationState !== "string" || signatures === null) return { status: "failed" };
  const fullyValid = response.code === 0;
  // Exit 0 promises a fully valid result; a state that disagrees is not trusted.
  if (fullyValid !== (validationState === "valid")) return { status: "failed" };
  return { status: "validated", validationState, fullyValid, signatureCount: signatures };
}

/**
 * @param {{ platform?: string, roots?: string[] }} options
 * @param {{ find?: () => Promise<{ bundle: string, helper: string } | null>, verify?: (bundle: string) => Promise<unknown>,
 *   run?: typeof runChevron7Cli }} [dependencies]
 */
export function createChevron7Cli(options, dependencies = {}) {
  const find = dependencies.find ?? (async () => {
    if (options.platform !== "darwin") return null;
    const installation = await findChevron7Signing({ platform: options.platform, roots: options.roots ?? [] });
    const helper = installation && await findChevron7Helper(installation.bundle);
    return helper ? { bundle: installation.bundle, helper } : null;
  });
  const verify = dependencies.verify ?? (bundle => exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", "-R", CHEVRON7_REQUIREMENT, bundle], { timeout: 15_000, maxBuffer: 4096 }));
  const run = dependencies.run ?? runChevron7Cli;
  let busy = false;
  let disposed = false;
  let controller;

  async function call(command, file, clientRoot, interpret) {
    if (disposed) return { status: "unavailable" };
    if (busy) return { status: "busy" };
    busy = true;
    controller = new AbortController();
    try {
      const installation = await find();
      if (!installation || disposed) return { status: "unavailable" };
      try { await verify(installation.bundle); } catch { return { status: "unavailable" }; }
      if (disposed) return { status: "unavailable" };
      // Resolve right before the spawn to keep the check-to-use window short; the helper's --root is the second layer.
      const target = await resolveClientPdf(file, clientRoot);
      if (!target) return { status: "invalid-file" };
      if (disposed) return { status: "unavailable" };
      const args = ["--session", chevron7Session(target.root), command, target.file, "--root", target.root, "--json"];
      return interpret(await run(installation.helper, args, { signal: controller.signal }));
    } catch { return { status: "failed" }; }
    finally { busy = false; controller = undefined; }
  }

  return {
    /** Structural inspection: `unsigned` only when Chevron7 reports no signature and no unverified document. */
    inspect: (file, clientRoot) => call("inspect", file, clientRoot, inspectResult),
    /** Trusted validation of a signed output; exit 10 is a completed, not fully valid, validation. */
    validate: (file, clientRoot) => call("validate", file, clientRoot, validateResult),
    dispose() { disposed = true; controller?.abort(); },
  };
}
