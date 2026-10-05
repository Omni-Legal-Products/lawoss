import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runCli } from "../okf-pamat/src/cli.ts";
import { findClientDir, findOfficeDir, findSubjectDir } from "../okf-pamat/src/store.ts";
import { checkedDirectory, contained } from "../okf-pamat/src/workspace-memory-fs.ts";
import { decodeText } from "../okf-pamat/src/text-decode.ts";

import { createWorkspaceHandoff, hasWorkspaceBinding, workspaceProfilePresent } from "./workspace-checkpoint.mjs";

const digest = (text) => createHash("sha256").update(text).digest("hex");
const MAX_CONTEXT_BYTES = 2 * 1024 * 1024;
const MATTER_CARD_TYPES = {
  "matter.md": /^(?:spis|matter)$/,
  "spis.md": /^(?:spis|matter)$/,
  "project.md": /^(?:projekt|project)$/,
  "projekt.md": /^(?:projekt|project)$/,
};

function matterBinding(directory) {
  try {
    const root = realpathSync(directory);
    const cards = Object.keys(MATTER_CARD_TYPES).filter((name) => existsSync(join(root, name)));
    if (!cards.length) return null;
    const contents = cards.map((name) => {
      const path = join(root, name);
      if (!lstatSync(path).isFile()) throw new Error("Matter card must be a regular file");
      // Karta uložená na Windows s BOM alebo v UTF-16 je stále karta veci, nie dôvod mlčky vypnúť handoff.
      return decodeText(readFileSync(path));
    });
    if (contents.some((text, index) => {
      const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
      const type = /^type:[ \t]*([^\r\n]+)[ \t]*\r?$/m.exec(header ?? "")?.[1];
      return !type || !MATTER_CARD_TYPES[cards[index]]?.test(type);
    })) return null;
    if (contents.some((text) => text !== contents[0])) return null;
    if (!lstatSync(join(root, "memory")).isDirectory()) return null;
    return { root, cardHash: digest(contents[0]) };
  } catch { return null; }
}

function assertHostScopeReadable(root, grants) {
  if (!Array.isArray(grants)) throw new Error("Host memory permissions unavailable; verify this workspace's native folder permissions.");
  const allowed = [...new Set(grants.map(path => checkedDirectory(path)))];
  const scope = [root, findSubjectDir(root), findClientDir(root), findOfficeDir(root)].filter((path, index, paths) => typeof path === "string" && paths.indexOf(path) === index);
  for (const path of scope) {
    const canonical = checkedDirectory(path);
    if (!allowed.some(grant => contained(grant, canonical))) throw new Error("Host memory permissions do not allow every matter scope root.");
  }
}

async function readScopeWithHostGrant(cli, root, resolveAllowedRoots) {
  if (resolveAllowedRoots) assertHostScopeReadable(root, await resolveAllowedRoots());
  return cli(["read", root]);
}

async function syncScopeWithHostGrant(cli, root, resolveAllowedRoots) {
  if (resolveAllowedRoots) assertHostScopeReadable(root, await resolveAllowedRoots());
  return cli(["sync", root, "--apply"]);
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
export function createHandoff(directory, { cli = runCli, now = () => new Date().toISOString(), resolveAllowedRoots, profilePath, profileIdentity, profileGrants, handoffRoot } = {}) {
  if (profilePath || workspaceProfilePresent(directory) || hasWorkspaceBinding(directory)) return createWorkspaceHandoff(directory, { now, resolveAllowedRoots, profilePath, profileIdentity, profileGrants, handoffRoot });
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
        const read = await readScopeWithHostGrant(cli, binding.root, resolveAllowedRoots);
        if (read.code !== 0) throw new Error(read.out.split("\nSpis:")[0].trim());
        if (Buffer.byteLength(read.out, "utf8") > MAX_CONTEXT_BYTES) throw new Error("OKF context exceeds the 2 MiB checkpoint limit; read the matter directly");
        const hash = digest(read.out);
        const unchanged = lastGood.get(sessionId)?.contextHash === hash && existsSync(path) &&
          digest(readFileSync(path, "utf8")) === lastGood.get(sessionId)?.artifactHash;
        if (!unchanged) {
          const sync = await syncScopeWithHostGrant(cli, binding.root, resolveAllowedRoots);
          if (sync.code !== 0) throw new Error(sync.out);
          const check = await readScopeWithHostGrant(cli, binding.root, resolveAllowedRoots);
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
