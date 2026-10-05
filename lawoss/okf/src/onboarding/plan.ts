import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { realpath } from "../canonical-path.ts";
import { join } from "node:path";
import { planEntity, type ClientType, type DocumentLanguage, type Jurisdiction } from "../core.ts";
import { LOCALIZED_TEMPLATES } from "../templates.ts";
import { PROFILE_FILE, parseWorkingProfile } from "../profile.ts";
import { inspectOnboardingRoot, type TreeEntry } from "./classify.ts";
import type { CreateOperation, OnboardingPlan } from "./transaction.ts";

export type ClientConversionInput = {
  title: string;
  clientType: ClientType;
  language: DocumentLanguage;
  jurisdiction: Jurisdiction;
  date: string;
  /** Required when no card proves the selected directory is a client. */
  confirmUnknownClient?: boolean;
};

export type ClientConversionPreview = {
  mode: "convert";
  appFiles: "inside";
  plan: OnboardingPlan;
  preserved: string[];
  archiveSources: string[];
};

function validateInput(input: ClientConversionInput): void {
  if (!input || typeof input.title !== "string" || !input.title.trim() || input.title.length > 500 || /[\u0000-\u001f]/.test(input.title)) throw new Error("A single-line client title is required.");
  if (!["fo", "fo-podnikatel", "po", "iny"].includes(input.clientType) || !["sk", "cs", "en"].includes(input.language) || !["sk", "cz"].includes(input.jurisdiction)) throw new Error("Explicit client type, language and jurisdiction are required.");
  if (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || new Date(`${input.date}T00:00:00Z`).toISOString().slice(0, 10) !== input.date) throw new Error("A valid ISO date is required.");
  if (input.confirmUnknownClient !== undefined && typeof input.confirmUnknownClient !== "boolean") throw new Error("Invalid client confirmation.");
}

/** Read only a bounded control file whose bytes still match the inspected tree. */
export async function readInspectedText(root: string, entry: TreeEntry): Promise<string> {
  if (!["AGENTS.md", "CLAUDE.md", PROFILE_FILE].includes(entry.path) || entry.kind !== "file" || entry.size > 1024 * 1024 || !entry.digest) throw new Error("Invalid inspected control file.");
  if (await realpath(root) !== root || !(await lstat(root)).isDirectory()) throw new Error("The client root changed.");
  const path = join(root, entry.path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true }), linked = await lstat(path, { bigint: true });
    if (!opened.isFile() || linked.isSymbolicLink() || opened.ino !== linked.ino || opened.dev !== linked.dev || opened.size !== BigInt(entry.size)) throw new Error("The instruction file changed.");
    const buffer = Buffer.alloc(entry.size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const next = await handle.read(buffer, bytes, buffer.length - bytes, null);
      if (!next.bytesRead) break;
      bytes += next.bytesRead;
    }
    const after = await handle.stat({ bigint: true }), current = await lstat(path, { bigint: true });
    const content = buffer.subarray(0, bytes);
    if (bytes !== entry.size || after.ctimeNs !== opened.ctimeNs || after.mtimeNs !== opened.mtimeNs || after.size !== opened.size || current.isSymbolicLink() || current.ino !== opened.ino || current.dev !== opened.dev || createHash("sha256").update(content).digest("hex") !== entry.digest) throw new Error("The instruction file changed.");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
  } finally { await handle.close(); }
}

/** Additive retrofit of one existing client. It never infers a client from an office or matter. */
export async function planClientConversion(root: string, input: ClientConversionInput): Promise<ClientConversionPreview> {
  validateInput(input);
  const inspection = await inspectOnboardingRoot(root);
  if (!inspection.complete || !inspection.digest || inspection.level === "conflict") throw new Error("The directory could not be inspected completely and unambiguously.");
  if (inspection.level !== "client" && !(inspection.level === "unknown" && input.confirmUnknownClient === true)) throw new Error("Select a client directory or explicitly confirm an unrecognized directory as a client.");
  const existing = new Map(inspection.entries.map(entry => [entry.path, entry]));
  const profileEntry = existing.get(PROFILE_FILE);
  const workingProfile = profileEntry ? parseWorkingProfile(await readInspectedText(inspection.root, profileEntry)) : undefined;
  const planned = planEntity({ type: "klient", dir: inspection.root, ...input, workingProfile }, LOCALIZED_TEMPLATES, path => existing.has(path));
  // A single existing instruction file is authoritative; creating its mirror never rewrites it.
  const agents = existing.get("AGENTS.md"), claude = existing.get("CLAUDE.md");
  for (const entry of [agents, claude]) if (entry && (entry.kind !== "file" || entry.size > 1024 * 1024)) throw new Error("Instruction files must be regular files within the size limit.");
  const agentsText = agents ? await readInspectedText(inspection.root, agents) : undefined;
  const claudeText = claude ? await readInspectedText(inspection.root, claude) : undefined;
  if (agentsText !== undefined && claudeText !== undefined && agentsText !== claudeText) throw new Error("AGENTS.md and CLAUDE.md differ. Resolve their contents before conversion.");
  const instructionText = agentsText ?? claudeText;
  if (instructionText !== undefined) for (const entry of planned.entries) if (["AGENTS.md", "CLAUDE.md"].includes(entry.path) && entry.action === "create") entry.content = instructionText;

  const operations: CreateOperation[] = [];
  const directories = new Set<string>();
  function directory(path: string): void {
    if (!path || directories.has(path)) return;
    const entry = existing.get(path);
    if (entry) {
      if (entry.kind !== "directory") throw new Error(`A file blocks the planned directory: ${path}`);
      return;
    }
    directory(path.split("/").slice(0, -1).join("/"));
    directories.add(path);
    operations.push({ path, kind: "directory" });
  }
  for (const entry of planned.entries) {
    if (entry.action === "skip") {
      if (existing.get(entry.path)?.kind !== "file") throw new Error(`A directory blocks the planned file: ${entry.path}`);
      continue;
    }
    directory(entry.path.split("/").slice(0, -1).join("/"));
    operations.push({ path: entry.path, kind: "file", content: entry.content ?? "" });
  }
  directory("memory");
  const verified = await inspectOnboardingRoot(root);
  if (!verified.complete || verified.digest !== inspection.digest) throw new Error("The directory changed while preparing the preview. Inspect it again.");
  return {
    mode: "convert", appFiles: "inside",
    plan: { version: 1, root: inspection.root, treeDigest: inspection.digest, operations },
    preserved: inspection.entries.filter(entry => entry.kind === "file").map(entry => entry.path),
    archiveSources: inspection.memorySources,
  };
}
