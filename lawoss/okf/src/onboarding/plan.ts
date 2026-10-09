import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { realpath } from "../canonical-path.ts";
import { join } from "node:path";
import { planEntity, type ClientType, type DocumentLanguage, type Jurisdiction } from "../core.ts";
import { LOCALIZED_TEMPLATES } from "../templates.ts";
import { PROFILE_FILE, parseWorkingProfile } from "../profile.ts";
import { inspectCardLevel, inspectOnboardingParent, inspectOnboardingRoot, MEMORY_FILES, type TreeEntry } from "./classify.ts";
import { incompleteInspectionMessage } from "./messages.ts";
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

const CONTROL_FILES = ["AGENTS.md", "CLAUDE.md", PROFILE_FILE];
const CONTROL_LIMIT = 1024 * 1024;
const INSTRUCTION_LIMIT = "Instruction files must be regular files within the size limit.";
const UNINSPECTABLE = "The directory could not be inspected completely and unambiguously.";
const NOT_CLIENT = "Select a client directory or explicitly confirm an unrecognized directory as a client.";
const CHANGED = "The directory changed while preparing the preview. Inspect it again.";
type Planned = ReturnType<typeof planEntity>;
type ExistingKind = (path: string) => TreeEntry["kind"] | undefined;

/**
 * Ohraničené čítanie riadiaceho súboru v koreni bez sledovania odkazu (najviac 1 MiB, bežný súbor,
 * striktné UTF-8). S `expected` musia bajty sedieť s plnou inšpekciou; bez neho platí len limit veľkosti.
 */
async function readControlFile(root: string, name: string, expected?: { size: number; digest: string }, limitMessage = INSTRUCTION_LIMIT): Promise<string> {
  if (await realpath(root) !== root || !(await lstat(root)).isDirectory()) throw new Error("The client root changed.");
  const path = join(root, name);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true }), linked = await lstat(path, { bigint: true });
    if (!opened.isFile() || linked.isSymbolicLink() || opened.ino !== linked.ino || opened.dev !== linked.dev || (expected && opened.size !== BigInt(expected.size))) throw new Error("The instruction file changed.");
    if (opened.size > BigInt(CONTROL_LIMIT)) throw new Error(limitMessage);
    const size = Number(opened.size);
    const buffer = Buffer.alloc(size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const next = await handle.read(buffer, bytes, buffer.length - bytes, null);
      if (!next.bytesRead) break;
      bytes += next.bytesRead;
    }
    const after = await handle.stat({ bigint: true }), current = await lstat(path, { bigint: true });
    const content = buffer.subarray(0, bytes);
    if (bytes !== size || after.ctimeNs !== opened.ctimeNs || after.mtimeNs !== opened.mtimeNs || after.size !== opened.size || current.isSymbolicLink() || current.ino !== opened.ino || current.dev !== opened.dev || (expected && createHash("sha256").update(content).digest("hex") !== expected.digest)) throw new Error("The instruction file changed.");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
  } finally { await handle.close(); }
}

/** Read only a bounded control file whose bytes still match the inspected tree. */
export async function readInspectedText(root: string, entry: TreeEntry): Promise<string> {
  if (!CONTROL_FILES.includes(entry.path) || entry.kind !== "file" || entry.size > CONTROL_LIMIT || !entry.digest) throw new Error("Invalid inspected control file.");
  return readControlFile(root, entry.path, { size: entry.size, digest: entry.digest });
}

/** A single existing instruction file is authoritative; creating its mirror never rewrites it. */
function mirrorInstructions(planned: Planned, agentsText: string | undefined, claudeText: string | undefined): void {
  if (agentsText !== undefined && claudeText !== undefined && agentsText !== claudeText) throw new Error("AGENTS.md and CLAUDE.md differ. Resolve their contents before conversion.");
  const instructionText = agentsText ?? claudeText;
  if (instructionText !== undefined) for (const entry of planned.entries) if (["AGENTS.md", "CLAUDE.md"].includes(entry.path) && entry.action === "create") entry.content = instructionText;
}

/** Operácie prevodu len pridávajú; existujúci súbor v ceste priečinka alebo priečinok namiesto súboru plán zastaví. */
function conversionOperations(planned: Planned, existing: ExistingKind): CreateOperation[] {
  const operations: CreateOperation[] = [];
  const directories = new Set<string>();
  function directory(path: string): void {
    if (!path || directories.has(path)) return;
    const kind = existing(path);
    if (kind) {
      if (kind !== "directory") throw new Error(`A file blocks the planned directory: ${path}`);
      return;
    }
    directory(path.split("/").slice(0, -1).join("/"));
    directories.add(path);
    operations.push({ path, kind: "directory" });
  }
  for (const entry of planned.entries) {
    if (entry.action === "skip") {
      if (existing(entry.path) !== "file") throw new Error(`A directory blocks the planned file: ${entry.path}`);
      continue;
    }
    directory(entry.path.split("/").slice(0, -1).join("/"));
    operations.push({ path: entry.path, kind: "file", content: entry.content ?? "" });
  }
  directory("memory");
  return operations;
}

/** Additive retrofit of one existing client. It never infers a client from an office or matter. */
export async function planClientConversion(root: string, input: ClientConversionInput): Promise<ClientConversionPreview> {
  validateInput(input);
  const inspection = await inspectOnboardingRoot(root);
  if (!inspection.complete || !inspection.digest || inspection.level === "conflict") throw new Error(incompleteInspectionMessage(UNINSPECTABLE, inspection.issues));
  if (inspection.level !== "client" && !(inspection.level === "unknown" && input.confirmUnknownClient === true)) throw new Error(NOT_CLIENT);
  const existing = new Map(inspection.entries.map(entry => [entry.path, entry]));
  const profileEntry = existing.get(PROFILE_FILE);
  const workingProfile = profileEntry ? parseWorkingProfile(await readInspectedText(inspection.root, profileEntry)) : undefined;
  const planned = planEntity({ type: "klient", dir: inspection.root, ...input, workingProfile }, LOCALIZED_TEMPLATES, path => existing.has(path));
  const agents = existing.get("AGENTS.md"), claude = existing.get("CLAUDE.md");
  for (const entry of [agents, claude]) if (entry && (entry.kind !== "file" || entry.size > CONTROL_LIMIT)) throw new Error(INSTRUCTION_LIMIT);
  const agentsText = agents ? await readInspectedText(inspection.root, agents) : undefined;
  const claudeText = claude ? await readInspectedText(inspection.root, claude) : undefined;
  mirrorInstructions(planned, agentsText, claudeText);
  const operations = conversionOperations(planned, path => existing.get(path)?.kind);
  const verified = await inspectOnboardingRoot(root);
  if (!verified.complete || verified.digest !== inspection.digest) throw new Error(CHANGED);
  return {
    mode: "convert", appFiles: "inside",
    plan: { version: 1, root: inspection.root, treeDigest: inspection.digest, operations },
    preserved: inspection.entries.filter(entry => entry.kind === "file").map(entry => entry.path),
    archiveSources: inspection.memorySources,
  };
}

async function lstatKind(path: string): Promise<TreeEntry["kind"] | null> {
  try {
    const state = await lstat(path);
    return state.isSymbolicLink() ? "symlink" : state.isDirectory() ? "directory" : state.isFile() ? "file" : "unsupported";
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Druh vnorených plánovaných ciest (`Spisy/.keep`, `memory/...`) cez lstat bez sledovania odkazov,
 * po častiach zhora: pod chýbajúcou položkou nič nie je a pod súborom či odkazom sa nečíta.
 * `null` znamená, že cesta neexistuje.
 */
async function nestedKinds(root: string, top: ReadonlyMap<string, TreeEntry>, paths: readonly string[]): Promise<Map<string, TreeEntry["kind"] | null>> {
  const kinds = new Map<string, TreeEntry["kind"] | null>();
  const kindOf = (path: string) => path.includes("/") ? kinds.get(path) ?? null : top.get(path)?.kind ?? null;
  for (const path of paths) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join("/"), current = parts.slice(0, index + 1).join("/");
      if (kindOf(parent) !== "directory") break;
      if (kinds.has(current)) continue;
      try { kinds.set(current, await lstatKind(join(root, current))); }
      catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "read_failed";
        throw new Error(incompleteInspectionMessage(UNINSPECTABLE, [{ path: current, code }]));
      }
    }
  }
  return kinds;
}

/** Riadiaci súbor z najvyššej úrovne: musí byť bežný súbor, číta sa ohraničene bez sledovania odkazu. */
async function readTopLevelControl(root: string, entry: TreeEntry | undefined, message: string): Promise<string | undefined> {
  if (!entry) return undefined;
  if (entry.kind !== "file") throw new Error(message);
  return readControlFile(root, entry.path, undefined, message);
}

/**
 * „Nie, len pridaj OKF súbory“: prevod existujúceho klienta, ktorý len pridá položky najvyššej úrovne
 * (karta, inštrukcie, pamäť, pracovné priečinky). Stačí plytká kontrola koreňa ako pri zakladaní
 * (`scope: "parent"`), takže symbolický odkaz, zamknutý dokument či 10 000 položiek v podpriečinku
 * prevod nezastavia. Vnorené plánované cesty sa overia cez lstat, plán preto nikdy nezakladá nič
 * existujúce; transakcia to pri zápise stráži znova (O_EXCL, kontrola rodiča). Plný plán
 * (`planClientConversion`) ostáva pre CLI `okf onboard plan` a skúšobný klon.
 */
export async function planShallowClientConversion(root: string, input: ClientConversionInput): Promise<ClientConversionPreview> {
  validateInput(input);
  const identity = await inspectCardLevel(root);
  if (identity.level === "conflict" || identity.issues.length) throw new Error(incompleteInspectionMessage(UNINSPECTABLE, identity.issues));
  if (identity.level !== "client" && !(identity.level === "unknown" && input.confirmUnknownClient === true)) throw new Error(NOT_CLIENT);
  const inspection = await inspectOnboardingParent(root);
  if (!inspection.complete || !inspection.digest) throw new Error(incompleteInspectionMessage(UNINSPECTABLE, inspection.issues));
  const top = new Map(inspection.entries.map(entry => [entry.path, entry]));
  const profileText = await readTopLevelControl(inspection.root, top.get(PROFILE_FILE), "Invalid inspected control file.");
  const workingProfile = profileText === undefined ? undefined : parseWorkingProfile(profileText);
  const plan = (exists: (path: string) => boolean) => planEntity({ type: "klient", dir: inspection.root, ...input, workingProfile }, LOCALIZED_TEMPLATES, exists);
  // Zoznam ciest nezávisí od existencie (mení sa len vytvoriť/preskočiť), preto prvý prechod určí, čo overiť.
  const candidates = new Set(plan(path => top.has(path)).entries.map(entry => entry.path));
  candidates.add("memory");
  const nested = await nestedKinds(inspection.root, top, [...candidates]);
  const existing: ExistingKind = path => (path.includes("/") ? nested.get(path) : top.get(path)?.kind) ?? undefined;
  const planned = plan(path => existing(path) !== undefined);
  if (planned.entries.some(entry => !candidates.has(entry.path))) throw new Error(CHANGED);
  const agents = top.get("AGENTS.md"), claude = top.get("CLAUDE.md");
  for (const entry of [agents, claude]) if (entry && entry.kind !== "file") throw new Error(INSTRUCTION_LIMIT);
  const agentsText = await readTopLevelControl(inspection.root, agents, INSTRUCTION_LIMIT);
  const claudeText = await readTopLevelControl(inspection.root, claude, INSTRUCTION_LIMIT);
  mirrorInstructions(planned, agentsText, claudeText);
  const operations = conversionOperations(planned, existing);
  const archiveSources: string[] = [];
  for (const entry of inspection.entries) {
    if (entry.kind === "file" && MEMORY_FILES.has(entry.path)) archiveSources.push(entry.path);
    if (entry.kind === "directory" && entry.path === ".lawoss" && await lstatKind(join(inspection.root, ".lawoss", "memory-profile.json")) === "file") archiveSources.push(".lawoss/memory-profile.json");
  }
  const verified = await inspectOnboardingParent(root);
  if (!verified.complete || verified.digest !== inspection.digest) throw new Error(CHANGED);
  return {
    mode: "convert", appFiles: "inside",
    plan: { version: 1, root: inspection.root, treeDigest: inspection.digest, operations, scope: "parent" },
    preserved: inspection.entries.filter(entry => entry.kind === "file").map(entry => entry.path),
    archiveSources,
  };
}
