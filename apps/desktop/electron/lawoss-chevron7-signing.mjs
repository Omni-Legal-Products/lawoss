// The installed Chevron7 Quick Action owns certificate selection and PIN entry.
// No credential, helper output, document bytes or signing path crosses renderer IPC.
import { access, realpath, stat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { CHEVRON7_BUNDLE_ID, findChevron7App } from "./lawoss-chevron7.mjs";

const exec = promisify(execFile);
const resources = "Contents/Resources/Chevron7 Finder Quick Action.workflow/Contents/Resources";

export async function findChevron7Signing({ platform, arch = process.arch, roots }) {
  if (platform !== "darwin") return null;
  for (const root of roots) {
    const bundle = path.join(root, "Chevron7.app");
    try {
      const plist = path.join(bundle, "Contents/Info.plist");
      const { stdout: identity } = await exec("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", plist], { timeout: 3000, maxBuffer: 4096 });
      if (identity.trim() !== CHEVRON7_BUNDLE_ID) continue;
      const { stdout } = await exec("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", plist], { timeout: 3000, maxBuffer: 4096 });
      const version = /^\d+(?:\.\d+){1,3}$/.test(stdout.trim()) ? stdout.trim() : undefined;
      let available = arch === "arm64";
      const script = path.join(bundle, resources, "chevron7-quick-action.sh");
      const canonicalBundle = await realpath(bundle);
      for (const file of [script, path.join(bundle, resources, "chevron7-cli-sign.sh"),
        path.join(bundle, "Contents/Helpers/AutogramCLI-arm64"), path.join(bundle, "Contents/Helpers/AutogramQuickActionRunner-arm64")]) {
        try {
          await access(file, constants.R_OK | constants.X_OK);
          if (!(await stat(file)).isFile() || !(await realpath(file)).startsWith(`${canonicalBundle}${path.sep}`)) available = false;
        } catch { available = false; }
      }
      return { bundle, script, version, available };
    } catch { /* Absent or unsupported installed version. */ }
  }
  return null;
}

export async function isSigningPdf(file) {
  if (typeof file !== "string" || !path.isAbsolute(file) || path.extname(file).toLowerCase() !== ".pdf") return false;
  const info = await stat(file);
  if (!info.isFile() || info.size < 5) return false;
  const handle = await open(file, "r");
  try {
    const header = Buffer.alloc(5);
    await handle.read(header, 0, 5, 0);
    return header.toString("ascii") === "%PDF-";
  } finally { await handle.close(); }
}

/**
 * @param {string} script
 * @param {string} file
 * @param {{ timeout?: number, signal?: AbortSignal }} options
 */
export function runChevron7QuickAction(script, file, { timeout = 15 * 60_000, signal } = {}) {
  return new Promise(resolve => {
    // argv, not a shell command. Never retain stdout/stderr (may contain identity data).
    const child = spawn("/bin/bash", [script, file], { stdio: "ignore", detached: true,
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } });
    let stopped = false;
    let killTimer;
    const kill = sig => { try { if (child.pid) process.kill(-child.pid, sig); } catch { /* Already gone. */ } };
    const stop = () => { if (stopped) return; stopped = true; kill("SIGTERM"); killTimer = setTimeout(() => kill("SIGKILL"), 1500); };
    const timer = setTimeout(stop, timeout);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    const finish = result => {
      clearTimeout(timer);
      // Stop remaining descendants too after a timed out or cancelled shell.
      if (stopped) kill("SIGKILL");
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", stop);
      resolve(result);
    };
    child.once("error", () => finish({ status: "failed" }));
    // Quick Action exits zero on both user cancellation and completion. Do not claim a signature.
    child.once("close", code => finish({ status: stopped ? "interrupted" : code === 0 ? "returned" : "failed" }));
  });
}

export function createChevron7Signing(options, dependencies = {}) {
  const find = dependencies.find ?? (() => findChevron7Signing(options));
  const verify = dependencies.verify ?? (bundle => exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle], { timeout: 15_000, maxBuffer: 4096 }));
  const run = dependencies.run ?? runChevron7QuickAction;
  let busy = false;
  let controller;
  let disposed = false;
  return {
    async status() {
      const installation = await find();
      return installation ? { installed: true, version: installation.version, signingAvailable: installation.available }
        : { ...await findChevron7App(options), signingAvailable: false };
    },
    async sign({ chooseFile, confirmFile }) {
      if (disposed) return { status: "unavailable" };
      if (busy) return { status: "busy" };
      busy = true;
      controller = new AbortController();
      try {
        const installation = await find();
        if (!installation?.available || disposed) return { status: "unavailable" };
        const selection = await chooseFile();
        if (!selection || disposed) return { status: "cancelled" };
        const file = await realpath(selection);
        if (!await isSigningPdf(file)) return { status: "invalid-file" };
        if (!await confirmFile(path.basename(file)) || disposed) return { status: "cancelled" };
        await verify(installation.bundle);
        if (disposed) return { status: "cancelled" };
        return await run(installation.script, file, { signal: controller.signal });
      } catch { return { status: "failed" }; }
      finally { busy = false; controller = undefined; }
    },
    dispose() { disposed = true; controller?.abort(); },
  };
}
