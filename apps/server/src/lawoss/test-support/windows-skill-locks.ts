import { spyOn } from "bun:test";
import * as fs from "node:fs";
import * as files from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const roles = ["ownTest", "bun", "node", "antimalware", "indexer", "shell", "other"] as const;
type ProbeStatus = "complete" | "timeout" | "unavailable" | "overflow" | "invalid" | "unsupported";
type LockReceipt = { status: ProbeStatus; win32Status?: number; files?: number; owners?: Record<typeof roles[number], number> };
const bounded = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;

/** The child output is untrusted too: only these fixed numeric fields survive. */
export function projectWindowsSkillLocks(value: unknown): LockReceipt {
  if (!value || typeof value !== "object") return { status: "invalid" };
  const item = value as Record<string, unknown>;
  if (["timeout", "unavailable", "overflow", "invalid", "unsupported"].includes(String(item.status))) return { status: item.status as ProbeStatus };
  if (item.status !== "complete" || !bounded(item.win32Status, 65535) || !bounded(item.files, 16) || !item.owners || typeof item.owners !== "object") return { status: "invalid" };
  const owners = {} as Record<typeof roles[number], number>;
  for (const role of roles) {
    const count = (item.owners as Record<string, unknown>)[role];
    if (!bounded(count, 128)) return { status: "invalid" };
    owners[role] = count;
  }
  return { status: "complete", win32Status: item.win32Status, files: item.files, owners };
}

/** No shell, inherited profile, raw stderr or unbounded child/output lifetime. */
export async function runBoundedLockProbe(command: string, args: string[], input: string, timeoutMs = 2500): Promise<{ status: ProbeStatus; output?: string }> {
  return new Promise(resolveResult => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] }); }
    catch { resolveResult({ status: "unavailable" }); return; }
    let status: ProbeStatus = "complete", length = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { status = "timeout"; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > 65536) { status = "overflow"; child.kill("SIGKILL"); return; }
      chunks.push(chunk);
    });
    child.stdin?.on("error", () => {});
    child.once("error", () => { status = "unavailable"; });
    child.once("close", code => {
      clearTimeout(timer);
      if (status !== "complete") { resolveResult({ status }); return; }
      resolveResult(code === 0 ? { status, output: Buffer.concat(chunks).toString("utf8") } : { status: "unavailable" });
    });
    child.stdin?.end(input);
  });
}

const within = (root: string, path: string) => { const rel = relative(root, path); return rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
const isSynthetic = (root: string) => isAbsolute(root) && /^lawoss-auth-boundary-[A-Za-z0-9]+$/.test(basename(root));

async function windowsSkillLocks(root: string, source: string): Promise<LockReceipt> {
  if (process.platform !== "win32") return { status: "unsupported" };
  if (!isSynthetic(root) || source !== join(root, "workspace", ".opencode", "skills", "synthetic")) return { status: "invalid" };
  // Restart Manager does not support directories. No symlinks or paths outside
  // this exact test-owned source are registered, and no shutdown API is called.
  try {
    // This exact lifecycle has already deleted sample.md; SKILL.md is its only
    // remaining regular file. Avoid a diagnostic scan delaying the failure or
    // introducing more directory handles. Directory-only locks remain unknown.
    const paths = [join(source, "SKILL.md")];
    const result = await runBoundedLockProbe("pwsh.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", fileURLToPath(new URL("./windows-skill-locks.ps1", import.meta.url))], JSON.stringify({ files: paths, ownPid: process.pid }));
    if (result.status !== "complete") return { status: result.status };
    return projectWindowsSkillLocks(JSON.parse(result.output!));
  } catch { return { status: "unavailable" }; }
}

type Snapshot = { renameAttempts: number; watchers: { source: number; descendants: number; ancestors: number }; active: Array<{ operation: string; count: number }> };

/** Passive observation only, installed before this one fixture starts its server. */
export function observeSyntheticSkillPromotion(root: string, onFailure?: (snapshot: Snapshot, error: unknown) => Promise<void>) {
  root = resolve(root);
  if (!isSynthetic(root)) throw new Error("Synthetic auth fixture required");
  const source = join(root, "workspace", ".opencode", "skills", "synthetic");
  const watched = new Map<fs.FSWatcher, string>(), active = new Map<string, number>();
  const restores: Array<() => void> = [];
  let renameAttempts = 0;
  const snapshot = (): Snapshot => {
    const watchers = { source: 0, descendants: 0, ancestors: 0 };
    for (const path of watched.values()) {
      if (path === source) watchers.source++;
      else if (within(source, path)) watchers.descendants++;
      else if (within(path, source)) watchers.ancestors++;
    }
    return { renameAttempts, watchers, active: [...active].filter(([, count]) => count > 0).map(([operation, count]) => ({ operation, count })) };
  };
  const originalWatch = fs.watch;
  const watch = spyOn(fs, "watch").mockImplementation(((...args: any[]) => {
    const handle = (originalWatch as (...args: any[]) => fs.FSWatcher)(...args);
    const path = resolve(String(args[0]));
    if (within(root, path)) { watched.set(handle, path); handle.once("close", () => watched.delete(handle)); }
    return handle;
  }) as typeof fs.watch);
  restores.push(() => watch.mockRestore());
  for (const operation of ["readFile", "readdir", "realpath", "stat", "lstat", "writeFile", "rm", "rename"] as const) {
    const original = files[operation];
    // Node overloads have different argument/result types; forwarding preserves
    // each original argument and promise result without replacing any I/O.
    const observe = spyOn(files, operation).mockImplementation((...args: any[]) => {
      const owned = within(root, resolve(String(args[0])));
      const promotion = operation === "rename" && resolve(String(args[0])) === source;
      if (promotion) renameAttempts++;
      if (owned) active.set(operation, (active.get(operation) ?? 0) + 1);
      const finished = () => { if (owned) active.set(operation, (active.get(operation) ?? 1) - 1); };
      return (original as (...args: any[]) => Promise<any>)(...args).then(value => { finished(); return value; }, async error => {
        finished();
        if (promotion) {
          const state = snapshot();
          try {
            if (onFailure) await onFailure(state, error);
            else {
              const locks = await windowsSkillLocks(root, source);
              const code = ["EPERM", "EBUSY", "EACCES"].includes(error?.code) ? error.code : "other";
              console.error("Synthetic skill rename lock receipt", JSON.stringify({ code, ...state, locks }));
            }
          } catch { /* Diagnostics must preserve the original single-attempt failure. */ }
        }
        throw error;
      });
    });
    restores.push(() => observe.mockRestore());
  }
  return { snapshot, restore: () => { for (const restore of restores.reverse()) restore(); } };
}
