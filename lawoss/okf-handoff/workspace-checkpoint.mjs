import { randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { readWorkspaceMemory, renderWorkspaceMemory } from "../okf-pamat/src/workspace-memory.ts";
import { checkedDirectory, checkedPath, isHash, isObject, jsonText, readText, sha256 } from "../okf-pamat/src/workspace-memory-fs.ts";

const MAX_CONTEXT_BYTES = 2 * 1024 * 1024;
const MARKER_SUFFIX = ".workspace-binding.json";

function hostGrants(value) {
  if (value === undefined) return [];
  let roots;
  try { roots = JSON.parse(value); }
  catch { throw new Error("LAWOSS_MEMORY_ALLOWED_ROOTS must be valid JSON containing an array of absolute directory paths"); }
  if (!Array.isArray(roots) || roots.some(root => typeof root !== "string" || !isAbsolute(root) || root.includes("\0"))) {
    throw new Error("LAWOSS_MEMORY_ALLOWED_ROOTS must be a JSON array of absolute directory paths");
  }
  return roots;
}

function entry(path) {
  try { return lstatSync(path); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

/** Only detect presence here; the selected reader validates all ancestors and bytes. */
export function workspaceProfilePresent(directory) {
  try {
    const control = entry(join(directory, ".lawoss"));
    if (!control) return false;
    return !control.isDirectory() || Boolean(entry(join(directory, ".lawoss", "memory-profile.json")));
  } catch { return true; }
}

/** Restart after profile removal must not silently reactivate a typed matter. */
export function hasWorkspaceBinding(directory) {
  const folder = join(directory, ".lawoss", "handoff");
  try {
    const control = entry(join(directory, ".lawoss"));
    if (!control) return false;
    if (!control.isDirectory()) return true;
    const stat = entry(folder);
    if (!stat) return false;
    if (!stat.isDirectory()) return true;
    return readdirSync(folder).some(name => name.endsWith(MARKER_SUFFIX));
  } catch { return true; } // Unsafe control metadata also requires a visible failure hook.
}

function outputDirectory(root) {
  let folder = root;
  for (const name of [".lawoss", "handoff"]) {
    folder = join(folder, name);
    if (!checkedPath(folder, "directory", true)) mkdirSync(folder, { mode: 0o700 });
    checkedPath(folder, "directory");
    chmodSync(folder, 0o700);
  }
  return folder;
}

function atomic(path, text) {
  checkedPath(path, "file", true);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
    checkedPath(path, "file", true);
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

/** Explicit profile adapter. Metadata pins identity only and never provides root grants. */
export function createWorkspaceHandoff(directory, {
  now = () => new Date().toISOString(),
  read = readWorkspaceMemory,
  allowedRootsJson = process.env.LAWOSS_MEMORY_ALLOWED_ROOTS,
  resolveAllowedRoots,
} = {}) {
  let root = resolve(directory), startupError;
  let allowedRoots = [];
  try { root = checkedDirectory(directory); if (!resolveAllowedRoots) allowedRoots = hostGrants(allowedRootsJson); }
  catch (error) { startupError = error instanceof Error ? error.message : String(error); }
  const bindings = new Map();
  const lastGood = new Map();
  return {
    root,
    async checkpoint(sessionId, trigger) {
      if (typeof sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(sessionId)) return { ok: false, error: "Invalid session ID" };
      let statusPath;
      try {
        if (checkedDirectory(directory) !== root) throw new Error("Workspace root changed");
        const folder = outputDirectory(root);
        const path = join(folder, `${sessionId}.md`);
        const markerPath = join(folder, `${sessionId}${MARKER_SUFFIX}`);
        statusPath = join(folder, `${sessionId}.status.md`);
        // Check every destination even on unchanged reads; never follow a corrupted target.
        checkedPath(path, "file", true);
        checkedPath(markerPath, "file", true);
        atomic(statusPath, `# Memory handoff\n\nstate: pending\nsession: ${sessionId}\ntrigger: ${trigger}\nat: ${now()}\n`);
        if (startupError) throw new Error(startupError);
        const report = read(root, { allowedRoots: resolveAllowedRoots ? await resolveAllowedRoots() : allowedRoots });
        if (!report.present || !report.complete) throw new Error(`Incomplete file memory: ${report.problems.map(p => `${p.code}: ${p.message}`).join("; ") || "profile absent"}`);
        const current = { version: 1, root, matterId: report.matterId, bindingHash: report.bindingHash };
        let pinned = bindings.get(sessionId);
        if (checkedPath(markerPath, "file", true)) {
          const saved = jsonText(markerPath, 4096);
          if (!isObject(saved) || saved.version !== 1 || saved.root !== root || typeof saved.matterId !== "string" || !isHash(saved.bindingHash)) throw new Error("Invalid persisted workspace binding metadata");
          if (pinned && (saved.bindingHash !== pinned.bindingHash || saved.matterId !== pinned.matterId)) throw new Error("Persisted session binding changed");
          pinned = saved;
        } else if (pinned) throw new Error("Persisted session binding was removed");
        if (pinned && (pinned.bindingHash !== current.bindingHash || pinned.matterId !== current.matterId)) throw new Error("Workspace memory binding changed; start a new session before continuing");
        const context = renderWorkspaceMemory(report);
        if (Buffer.byteLength(context, "utf8") > MAX_CONTEXT_BYTES) throw new Error("File memory context exceeds the 2 MiB checkpoint limit; read sources directly");
        const check = read(root, { allowedRoots: resolveAllowedRoots ? await resolveAllowedRoots() : allowedRoots });
        if (!check.present || !check.complete || check.directory !== root || check.bindingHash !== report.bindingHash || check.contextHash !== report.contextHash) throw new Error("Workspace sources changed during checkpoint; read again before continuing");
        if (!pinned) atomic(markerPath, JSON.stringify(current, null, 2) + "\n");
        bindings.set(sessionId, current);
        const previous = lastGood.get(sessionId);
        const unchanged = previous?.contextHash === report.contextHash && checkedPath(path, "file", true) && readText(path, MAX_CONTEXT_BYTES + 8192).sha256 === previous.artifactHash;
        if (!unchanged) {
          const artifact = `---\ntype: generated-workspace-memory-handoff\nsession: ${sessionId}\ntrigger: ${trigger}\ngenerated_at: ${now()}\ncontext_sha256: ${report.contextHash}\nbinding_sha256: ${report.bindingHash}\n---\n\n# Generated file memory handoff\n\nDerived checkpoint of persisted sources, not proof of current legal status or human verification. Source dates are unchanged. Read current sources before SAVE.\n\n${context}\n`;
          atomic(path, artifact);
          lastGood.set(sessionId, { contextHash: report.contextHash, artifactHash: sha256(artifact) });
        }
        atomic(statusPath, `# Memory handoff\n\nstate: ready\nsession: ${sessionId}\ntrigger: ${trigger}\nat: ${now()}\ncontext_sha256: ${report.contextHash}\ncheckpoint: ${path}\n`);
        return { ok: true, changed: !unchanged, path, context, hash: report.contextHash };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (statusPath) {
          try { atomic(statusPath, `# Memory handoff\n\nstate: error\nsession: ${sessionId}\ntrigger: ${trigger}\nat: ${now()}\n\n${message}\n\nThe previous good checkpoint, if any, was preserved. It is not current.\n`); }
          catch { /* Unsafe status path: the lifecycle hook still exposes the error. */ }
        }
        return { ok: false, error: message };
      }
    },
  };
}
