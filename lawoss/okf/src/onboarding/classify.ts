import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { realpath } from "../canonical-path.ts";
import { basename, isAbsolute, join, resolve } from "node:path";
import { parseFrontmatter } from "../frontmatter.ts";

export type OnboardingLevel = "office" | "client" | "subject" | "matter" | "unknown" | "conflict";
export type TreeEntry = {
  path: string;
  kind: "file" | "directory" | "symlink" | "unsupported";
  digest: string | null;
  size: number;
};
export type OnboardingInspection = {
  root: string;
  level: OnboardingLevel;
  confidence: "confirmed" | "unknown";
  complete: boolean;
  digest: string | null;
  entries: TreeEntry[];
  memorySources: string[];
  issues: { path: string; code: string }[];
};
export type InspectionLimits = { maxEntries?: number; maxBytes?: number; maxDepth?: number };
const CARD_LEVELS: Record<string, "client" | "subject" | "matter"> = {
  "client.md": "client", "klient.md": "client", "subject.md": "subject",
  "matter.md": "matter", "spis.md": "matter", "project.md": "matter", "projekt.md": "matter",
};
const CARD_TYPES: Record<string, readonly string[]> = {
  "client.md": ["client", "klient"], "klient.md": ["client", "klient"], "subject.md": ["subject"],
  "matter.md": ["matter", "spis"], "spis.md": ["matter", "spis"],
  "project.md": ["project", "projekt"], "projekt.md": ["project", "projekt"],
};
/**
 * Súbory appky v otvorenom priečinku (OpenCode, jeho skilly a node_modules so symlinkami v `.bin`).
 * Mení ich engine, nie advokát, takže nepatria do identity klienta ani veci; bez tohto pravidla
 * nešlo pridať vec k už otvorenému klientovi (D1 2026-10-05).
 */
const APP_FILE_DIRECTORIES = new Set([".opencode"]);
const MEMORY_FILES = new Set(["MEMORY.md", "_memory.md", "_STATUS.md", "BRAIN.md", ".lawoss/memory-profile.json"]);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const errorCode = (error: unknown): string => error && typeof error === "object" && "code" in error ? String(error.code) : "read_failed";

/**
 * Plytká kontrola priečinka, do ktorého onboarding len pridáva nové položky
 * (kancelária, klient, subjekt, vec). Zaznamená mená a druhy položiek najvyššej
 * úrovne, nič nečíta, nehashuje a odkazy nesleduje. Rekurzívny sken by zlyhal
 * pri bežnom rodičovi: v Dokumentoch na Windows sú skryté junctions (My Music,
 * My Pictures, My Videos), v profile ďalšie, a veľký priečinok narazí na limit
 * 10 000 položiek či 1 GB. Zápis stráži transakcia: cieľ nesmie existovať
 * (aj bez ohľadu na veľkosť písmen) a rodič nesmie byť symbolický odkaz.
 */
export async function inspectOnboardingParent(root: string, limits: Pick<InspectionLimits, "maxEntries"> = {}): Promise<OnboardingInspection> {
  const maxEntries = limits.maxEntries ?? 10_000;
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new Error("Invalid inspection limits.");
  const result: OnboardingInspection = { root: resolve(root), level: "unknown", confidence: "unknown", complete: true, digest: null, entries: [], memorySources: [], issues: [] };
  const problem = (path: string, code: string) => { result.complete = false; result.issues.push({ path, code }); };
  try {
    if (!isAbsolute(root) || await realpath(root) !== resolve(root) || !(await lstat(root)).isDirectory()) {
      problem("", "canonical_directory_required"); return result;
    }
    const names = (await readdir(result.root)).sort();
    if (names.length > maxEntries) { problem("", "entry_limit"); return result; }
    for (const name of names) {
      try {
        const state = await lstat(join(result.root, name));
        const kind = state.isSymbolicLink() ? "symlink" : state.isDirectory() ? "directory" : state.isFile() ? "file" : "unsupported";
        result.entries.push({ path: name, kind, digest: null, size: 0 });
      } catch (error) {
        // Windows: systémovú položku (System Volume Information) nemusí byť možné ani lstat-nuť; meno stačí.
        const code = errorCode(error);
        if (code === "EPERM" || code === "EACCES" || code === "EBUSY") result.entries.push({ path: name, kind: "unsupported", digest: null, size: 0 });
        else problem(name, code);
      }
    }
  } catch (error) { problem("", errorCode(error)); return result; }
  if (result.complete) result.digest = sha(JSON.stringify(result.entries));
  return result;
}

/** Read-only inspection. Partial scans never produce a digest usable by apply. */
export async function inspectOnboardingRoot(root: string, limits: InspectionLimits = {}): Promise<OnboardingInspection> {
  const maxEntries = limits.maxEntries ?? 10_000;
  const maxBytes = limits.maxBytes ?? 1024 * 1024 * 1024;
  const maxDepth = limits.maxDepth ?? 32;
  if (![maxEntries, maxBytes, maxDepth].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("Invalid inspection limits.");
  const result: OnboardingInspection = { root: resolve(root), level: "unknown", confidence: "unknown", complete: true, digest: null, entries: [], memorySources: [], issues: [] };
  const problem = (path: string, code: string) => { result.complete = false; result.issues.push({ path, code }); };
  try {
    if (!isAbsolute(root) || await realpath(root) !== resolve(root) || !(await lstat(root)).isDirectory()) {
      problem("", "canonical_directory_required"); return result;
    }
  } catch (error) { problem("", errorCode(error)); return result; }
  let bytes = 0;
  let seenEntries = 0;
  let exhausted = false;
  const cardText = new Map<string, string>();
  async function visit(relative: string, depth: number): Promise<void> {
    if (exhausted) return;
    if (depth > maxDepth) { problem(relative, "depth_limit"); return; }
    try {
      const dir = join(result.root, relative);
      const before = await lstat(dir);
      if (!before.isDirectory() || before.isSymbolicLink() || await realpath(dir) !== dir) { problem(relative, "unsafe_directory"); return; }
      for (const name of (await readdir(dir)).sort()) {
        const path = relative ? `${relative}/${name}` : name;
        if (seenEntries >= maxEntries) { problem(path, "entry_limit"); exhausted = true; break; }
        seenEntries += 1;
        const full = join(result.root, path);
        const state = await lstat(full);
        if (state.isSymbolicLink()) {
          result.entries.push({ path, kind: "symlink", digest: null, size: 0 });
          problem(path, "symlink_not_followed");
          continue;
        }
        if (state.isDirectory()) {
          result.entries.push({ path, kind: "directory", digest: null, size: 0 });
          if (!APP_FILE_DIRECTORIES.has(name)) await visit(path, depth + 1);
        } else if (state.isFile()) {
          if (bytes + state.size > maxBytes) { problem(path, "byte_limit"); exhausted = true; break; }
          // Verify identity again after opening and after reading to reject changes during inspection.
          const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const opened = await handle.stat({ bigint: true });
            const current = await lstat(full, { bigint: true });
            if (!opened.isFile() || current.isSymbolicLink() || opened.ino !== current.ino || opened.dev !== current.dev) { problem(path, "changed_during_read"); continue; }
            const hash = createHash("sha256");
            const buffer = Buffer.alloc(64 * 1024);
            const parts: Buffer[] = [];
            let count = 0;
            while (true) {
              const read = await handle.read(buffer, 0, buffer.length, null);
              if (!read.bytesRead) break;
              count += read.bytesRead; bytes += read.bytesRead;
              if (bytes > maxBytes) { problem(path, "byte_limit"); exhausted = true; break; }
              const chunk = buffer.subarray(0, read.bytesRead);
              hash.update(chunk);
              if (CARD_LEVELS[path] && count <= 64 * 1024) parts.push(Buffer.from(chunk));
            }
            const after = await handle.stat({ bigint: true });
            const linked = await lstat(full, { bigint: true });
            if (after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs || linked.ino !== opened.ino || linked.dev !== opened.dev || linked.isSymbolicLink()) problem(path, "changed_during_read");
            if (CARD_LEVELS[path]) {
              if (count > 64 * 1024) problem(path, "card_size_limit");
              else cardText.set(path, Buffer.concat(parts).toString("utf8"));
            }
            result.entries.push({ path, kind: "file", digest: hash.digest("hex"), size: count });
            if (MEMORY_FILES.has(path)) result.memorySources.push(path);
          } finally { await handle.close(); }
        } else {
          result.entries.push({ path, kind: "unsupported", digest: null, size: 0 });
          problem(path, "unsupported_file_type");
        }
        if (exhausted) break;
      }
      const after = await lstat(dir);
      if (before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs) problem(relative, "changed_during_read");
    } catch (error) { problem(relative, errorCode(error)); }
  }
  await visit("", 0);
  const cards = result.entries.filter(entry => entry.kind === "file" && CARD_LEVELS[entry.path]);
  const officePaths = result.entries.filter(entry => entry.kind === "file" && /(?:^|\/)(?:Office|_kancelaria)\/okf\.config$/.test(entry.path));
  const directOffice = ["Office", "_kancelaria"].includes(basename(result.root)) && result.entries.some(entry => entry.path === "okf.config" && entry.kind === "file");
  const office = directOffice || officePaths.some(entry => ["Office/okf.config", "_kancelaria/okf.config"].includes(entry.path));
  const conflict = (code: string) => { result.level = "conflict"; result.issues.push({ path: "", code }); };
  if (cards.length > 1 || cards.length && office || officePaths.length > 1 || officePaths.some(entry => entry.path.split("/").length > 2)) conflict("conflicting_identity");
  else if (cards.length === 1) {
    const card = cards[0]!;
    const text = cardText.get(card.path);
    const metadata = text === undefined ? null : parseFrontmatter(text);
    const types = text?.match(/^type:/gm) ?? [];
    if (!metadata?.type || types.length !== 1 || !CARD_TYPES[card.path]?.includes(metadata.type)) conflict("invalid_card_type");
    else result.level = CARD_LEVELS[card.path]!;
  } else if (office) result.level = "office";
  if (result.complete && result.level !== "conflict") {
    result.digest = sha(JSON.stringify(result.entries));
    result.confidence = result.level === "unknown" ? "unknown" : "confirmed";
  }
  return result;
}
