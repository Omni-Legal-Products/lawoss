import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runCli } from "../okf-pamat/src/cli.ts";

import { createWorkspaceHandoff, hasWorkspaceBinding, workspaceProfilePresent } from "./workspace-checkpoint.mjs";

const digest = (text) => createHash("sha256").update(text).digest("hex");
const MAX_CONTEXT_BYTES = 2 * 1024 * 1024;

function matterBinding(directory) {
  try {
    const root = realpathSync(directory);
    const cards = ["matter.md", "spis.md"].filter((name) => existsSync(join(root, name)));
    if (!cards.length) return null;
    const contents = cards.map((name) => {
      const path = join(root, name);
      if (!lstatSync(path).isFile()) throw new Error("Matter card must be a regular file");
      return readFileSync(path, "utf8");
    });
    if (contents.some((text) => {
      const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
      return !header || !/^type:[ \t]*(?:spis|matter)[ \t]*\r?$/m.test(header);
    })) return null;
    if (contents.some((text) => text !== contents[0])) return null;
    if (!lstatSync(join(root, "memory")).isDirectory()) return null;
    return { root, cardHash: digest(contents[0]) };
  } catch { return null; }
}

function outputDirectory(root) {
  let path = root;
  for (const name of [".lawoss", "handoff"]) {
    path = join(path, name);
    if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
    if (!lstatSync(path).isDirectory() || realpathSync(path) !== path) throw new Error("Handoff directory must not be a symlink");
  }
  return path;
}

function atomic(path, text) {
  if (existsSync(path) && !lstatSync(path).isFile()) throw new Error("Handoff destination must be a regular file");
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

/** Only a workspace that IS a matter is eligible. Never scan or choose a descendant. */
export function createHandoff(directory, { cli = runCli, now = () => new Date().toISOString(), resolveAllowedRoots } = {}) {
  if (workspaceProfilePresent(directory) || hasWorkspaceBinding(directory)) return createWorkspaceHandoff(directory, { now, resolveAllowedRoots });
  const binding = matterBinding(directory);
  if (!binding) return null;
  const lastGood = new Map();
  return {
    root: binding.root,
    async checkpoint(sessionId, trigger) {
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(sessionId)) return { ok: false, error: "Invalid session ID" };
      let statusPath;
      try {
        if (realpathSync(directory) !== binding.root || resolve(binding.root) !== binding.root) throw new Error("Workspace root changed");
        const folder = outputDirectory(binding.root);
        const path = join(folder, `${sessionId}.md`);
        statusPath = join(folder, `${sessionId}.status.md`);
        atomic(statusPath, `# OKF handoff\n\nstate: pending\nsession: ${sessionId}\ntrigger: ${trigger}\nat: ${now()}\n`);
        const currentBinding = matterBinding(directory);
        if (!currentBinding || currentBinding.cardHash !== binding.cardHash) throw new Error("Matter binding changed; reopen this workspace before checkpointing");
        const read = cli(["read", binding.root]);
        if (read.code !== 0) throw new Error(read.out.split("\nSpis:")[0].trim());
        if (Buffer.byteLength(read.out, "utf8") > MAX_CONTEXT_BYTES) throw new Error("OKF context exceeds the 2 MiB checkpoint limit; read the matter directly");
        const hash = digest(read.out);
        const unchanged = lastGood.get(sessionId)?.contextHash === hash && existsSync(path) &&
          digest(readFileSync(path, "utf8")) === lastGood.get(sessionId)?.artifactHash;
        if (!unchanged) {
          const sync = cli(["sync", binding.root, "--apply"]);
          if (sync.code !== 0) throw new Error(sync.out);
          const check = cli(["read", binding.root]);
          if (check.code !== 0 || digest(check.out) !== hash || matterBinding(directory)?.cardHash !== binding.cardHash) throw new Error("Matter sources changed during checkpoint; read again before continuing");
          atomic(path, `---\ntype: generated-okf-handoff\nsession: ${sessionId}\ntrigger: ${trigger}\ngenerated_at: ${now()}\ncontext_sha256: ${hash}\ncard_sha256: ${binding.cardHash}\n---\n\n# Generated OKF handoff\n\nThis is a derived checkpoint of persisted sources, not a new memory record or human verification.\nRecord Revision hashes below refer to the canonical source records. Read the matter again before writing.\n\n${read.out}\n`);
          lastGood.set(sessionId, { contextHash: hash, artifactHash: digest(readFileSync(path, "utf8")) });
        }
        atomic(statusPath, `# OKF handoff\n\nstate: ready\nsession: ${sessionId}\ntrigger: ${trigger}\nat: ${now()}\ncontext_sha256: ${hash}\ncheckpoint: ${path}\n`);
        const result = { ok: true, changed: !unchanged, path, context: read.out, hash };
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (statusPath) {
          try { atomic(statusPath, `# OKF handoff\n\nstate: error\nsession: ${sessionId}\ntrigger: ${trigger}\nat: ${now()}\n\n${message}\n\nThe previous good checkpoint, if any, was preserved. It is not current.\n`); } catch { /* The hook also returns the failure for context injection/logging. */ }
        }
        const result = { ok: false, error: message };
        return result;
      }
    },
  };
}
