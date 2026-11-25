// The installed Chevron7 Quick Action owns certificate selection and PIN entry.
// Only the workspace identity and selected relative file path come from the renderer.
import { access, realpath, stat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { CHEVRON7_BUNDLE_ID, CHEVRON7_REQUIREMENT, findChevron7App } from "./lawoss-chevron7.mjs";
import { resolveProjectFolder } from "./project-file-copy.mjs";

const exec = promisify(execFile);
const pdfHeader = Buffer.from("%PDF-");
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
    return header.equals(pdfHeader);
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

/** The window route owns the current project. Unscoped session windows use the host selection. */
export function currentSigningWorkspace(request, windowUrl, state, server) {
  if (typeof request?.workspaceId !== "string" || !request.workspaceId || !server?.running ||
      typeof server.baseUrl !== "string" || request.serverUrl !== server.baseUrl.replace(/\/+$/, "")) return null;
  const endpoint = new URL(server.baseUrl);
  if (!["http:", "https:"].includes(endpoint.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) return null;
  const url = new URL(windowUrl);
  const route = url.hash.startsWith("#/") ? url.hash.slice(1) : url.pathname;
  const match = /^\/workspace\/([^/?#]+)(?:[/?#]|$)/.exec(route);
  const id = match ? decodeURIComponent(match[1]) : /^\/(?:session|home)(?:[/?#]|$)/.test(route) ? state.selectedId : null;
  if (id !== request.workspaceId || state.workspaces.some(item => item.id === id && item.workspaceType === "remote")) return null;
  return id;
}

/** Resolve the live preview server's root and reject conflicting native registrations. */
export async function signingWorkspaceRoot(request, windowUrl, state, server) {
  if (!windowUrl) return null;
  const id = currentSigningWorkspace(request, windowUrl, state, server);
  if (!id) return null;
  const root = await realpath(await resolveProjectFolder(id, [], server));
  const registered = state.workspaces.find(item => item.id === id);
  if (registered && await realpath(registered.path) !== root) return null;
  return root;
}

async function selectedPdf(root, relativePath) {
  if (typeof root !== "string" || !path.isAbsolute(root) || typeof relativePath !== "string" ||
      relativePath.length > 4096 || path.extname(relativePath).toLowerCase() !== ".pdf" ||
      /[\\\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(relativePath) || /^[a-z][a-z\d+.-]*:/i.test(relativePath) ||
      relativePath.split("/").some(part => !part || part === "." || part === "..")) return null;
  try {
    const directory = await realpath(root);
    const file = await realpath(path.join(directory, relativePath));
    const local = path.relative(directory, file);
    if (!local || local === ".." || local.startsWith(`..${path.sep}`) || path.isAbsolute(local) || !await isSigningPdf(file)) return null;
    const info = await stat(file, { bigint: true });
    return { file, identity: [info.dev, info.ino, info.size, info.ctimeNs].join("/") };
  } catch { return null; }
}

export function createChevron7Signing(options, dependencies = {}) {
  const find = dependencies.find ?? (() => findChevron7Signing(options));
  const verify = dependencies.verify ?? (bundle => exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", "-R", CHEVRON7_REQUIREMENT, bundle], { timeout: 15_000, maxBuffer: 4096 }));
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
    async sign({ relativePath, resolveWorkspace, confirmFile }) {
      if (disposed) return { status: "unavailable" };
      if (busy) return { status: "busy" };
      busy = true;
      controller = new AbortController();
      try {
        const installation = await find();
        if (!installation?.available || disposed) return { status: "unavailable" };
        const selected = await selectedPdf(await resolveWorkspace(), relativePath);
        if (!selected) return { status: "invalid-file" };
        if (disposed || !await confirmFile(selected.file)) return { status: "cancelled" };
        await verify(installation.bundle);
        const current = await selectedPdf(await resolveWorkspace(), relativePath);
        if (!current || current.file !== selected.file || current.identity !== selected.identity) return { status: "invalid-file" };
        if (disposed) return { status: "cancelled" };
        return await run(installation.script, current.file, { signal: controller.signal });
      } catch { return { status: "failed" }; }
      finally { busy = false; controller = undefined; }
    },
    dispose() { disposed = true; controller?.abort(); },
  };
}
