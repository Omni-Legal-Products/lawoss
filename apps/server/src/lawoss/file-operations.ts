/**
 * LAWOSS: premenovanie, presun, kópia, nový priečinok a presun do Koša s jednou čitateľnou kartou
 * (alfa 2, MČ 22. 10. 2026).
 *
 * Nástroj `lawoss_files` (plugin `lawoss-file-operations.ts`) sa najprv opýta servera na plán
 * (čitateľné „pôvodná → nová“ a revízia viazaná na kanonické cesty a identitu súborov), potom
 * požiada engine o vlastné povolenie `lawoss_file_change` jednou kartou s celým plánom
 * (`context.ask`, `always: []`) a až po schválení pošle ten istý plán s revíziou na vykonanie.
 * Server plán pred vykonaním zostaví znova: ak sa medzitým zmenil disk (cesta, obsah, čas zmeny,
 * obsah priečinka), nič nevykoná (409).
 *
 * Hranica: koreň klienta a jeho pripojené priečinky podľa tých istých pravidiel ako sandbox
 * (`linkableFolders`). Cudzí priečinok sa odmietne bez mena klienta, ktorému patrí. Nič sa
 * neprepíše: existujúci cieľ je chyba (okrem zmeny len veľkosti písmen toho istého súboru).
 * Zmazanie nie je trvalé: položka ide do systémového Koša (hostiteľ, `config.trashItem`), inak do
 * `.lawoss-kos/` v koreni, kde leží (rozhodnutie koordinátora alfa 2, I3). Výsledok hlási skutočný
 * stav disku.
 *
 * Routy prijmú len poverenie chatu z enginu: jeho `tokenHash` sa porovná s tajomstvom runtime
 * (`wiki/agent-access.ts`), nie s hlavičkou, ktorú môže poslať ktokoľvek.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { cp, lstat, mkdir, readdir, rename } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { withFileEditorHandoff } from "../file-editor-handoff.js";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory } from "../runtime-opencode-config-store.js";
import { authorizedFolders } from "../agent-sandbox/service.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import type { Actor, ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { ensureWikiAgentToken } from "../wiki/agent-access.js";
import { isSensitiveWorkspacePath, resolveWorkspaceFilePath } from "./filesystem-boundary.js";
import { linkableFolders } from "./linked-folders.js";
import { isPathWithin } from "./path-within.js";

const path = z.string().min(1).max(4096);
export const fileOperationSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("move"), from: path, to: path }),
  z.strictObject({ operation: z.literal("copy"), from: path, to: path }),
  z.strictObject({ operation: z.literal("create_folder"), path }),
  z.strictObject({ operation: z.literal("delete"), path }),
]);
export type FileOperation = z.infer<typeof fileOperationSchema>;
export const MAX_FILE_OPERATIONS = 50;
/** Folder contents counted and fingerprinted for the card and the change check. */
export const FOLDER_SURVEY_LIMIT = 1000;
/** Where deleted items go when the OS Trash is unavailable; never a target of this tool. */
export const LAWOSS_TRASH_FOLDER = ".lawoss-kos";
const operationsSchema = z.array(fileOperationSchema).min(1).max(MAX_FILE_OPERATIONS);

/** One planned change, as the card shows it (`from`/`to` relative to the client or linked folder). */
export type PublicFileOperation = {
  operation: FileOperation["operation"];
  kind: "file" | "folder";
  from?: string;
  to?: string;
  /** Items inside a folder that goes to the Trash or is copied; `entriesCapped` = at least this many. */
  entries?: number;
  entriesCapped?: true;
};
type Planned = PublicFileOperation & {
  source?: string;
  target?: string;
  /** Canonical root the source lies in (the Trash fallback stays inside it). */
  sourceRoot?: string;
  /** dev/ino/size/mtime of the source and, for a folder, a bounded fingerprint of its contents. */
  identity?: string;
  /** Case-only rename of the same file on a case-insensitive volume. */
  caseOnly?: true;
};
export type FileOperationResult = PublicFileOperation & {
  status: "done" | "failed" | "not_run";
  error?: string;
  /** Where a deleted item went: the OS Trash or the fallback folder (readable path). */
  trash?: "system" | string;
};
export type FilePlan = { operations: PublicFileOperation[]; revision: string };

const OUTSIDE = "This path is not in this client's folder or in a folder linked to this client. Nothing was changed. The user can link a folder that belongs to this client on the client's overview.";

/** Control and bidirectional characters would make a card line lie about the name; show them escaped. */
export function visibleName(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

type Root = { path: string; canonical: string; label: string | null };

async function clientRoots(config: ServerConfig, workspace: WorkspaceInfo): Promise<Root[]> {
  const linked = await linkableFolders(config, workspace, authorizedFolders(runtimeExternalDirectory(await readRuntimeOpencodeConfig(config, workspace.id))));
  const names = linked.map((folder) => basename(folder));
  // Two linked folders with the same name are told apart by their parent, then by the full path.
  const label = (folder: string, index: number) => {
    if (names.filter((name) => name === names[index]).length === 1) return names[index]!;
    const parentLabel = `${basename(dirname(folder))}/${names[index]}`;
    return linked.filter((other) => `${basename(dirname(other))}/${basename(other)}` === parentLabel).length === 1 ? parentLabel : folder;
  };
  const roots = [{ path: workspace.path, label: null }, ...linked.map((folder, index) => ({ path: folder, label: label(folder, index) }))];
  return Promise.all(roots.map(async (root) => ({ ...root, canonical: await resolveWorkspaceFilePath(root.path, ".", { allowRoot: true }) })));
}

/** Compared case-insensitively and without trailing dots/spaces, as APFS and NTFS resolve names. */
const PROTECTED_SEGMENTS = new Set([".git", LAWOSS_TRASH_FOLDER]);
function protectedPath(inside: string): boolean {
  return isSensitiveWorkspacePath(inside)
    || inside.split(/[\\/]/).some((part) => PROTECTED_SEGMENTS.has(part.toLowerCase().replace(/:.*$/, "").replace(/[. ]+$/, "")));
}

type Located = { canonical: string; display: string; root: string };

/** The canonical path in the client's folder or a linked folder; a link itself is moved, not its target. */
async function locate(roots: Root[], requested: string): Promise<Located> {
  for (const root of roots) {
    const canonical = await resolveWorkspaceFilePath(root.path, requested, { preserveLeaf: true }).catch(() => null);
    if (!canonical) continue;
    const inside = relative(root.canonical, canonical);
    if (protectedPath(inside))
      throw new ApiError(403, "file_operation_protected", "This path holds app, version-control or Trash data and cannot be changed with this tool. Nothing was changed.");
    return { canonical, root: root.canonical, display: visibleName(root.label ? `${root.label}/${inside.split(sep).join("/")}` : inside.split(sep).join("/")) };
  }
  throw new ApiError(403, "file_operation_outside_client", OUTSIDE);
}

async function present(location: string): Promise<Stats | null> {
  return lstat(location).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
}

const stamp = (info: Stats) => `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;

/** Bounded, deterministic walk: the count for the card and a fingerprint for the change check. */
async function survey(folder: string): Promise<{ entries: number; capped: boolean; fingerprint: string }> {
  const hash = createHash("sha256");
  let entries = 0;
  const pending = [folder];
  while (pending.length && entries < FOLDER_SURVEY_LIMIT) {
    const current = pending.shift() ?? folder;
    const children = (await readdir(current, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const child of children) {
      if (entries >= FOLDER_SURVEY_LIMIT) break;
      const location = join(current, child.name);
      const info = await present(location);
      entries++;
      hash.update(`${relative(folder, location)}\0${info ? stamp(info) : "gone"}\n`);
      if (child.isDirectory() && !child.isSymbolicLink()) pending.push(location);
    }
  }
  const capped = entries >= FOLDER_SURVEY_LIMIT;
  return { entries, capped, fingerprint: `${capped ? "capped:" : ""}${hash.digest("hex")}` };
}

/** Case-only rename: the target name resolves to the very same node as the source. */
async function sameNode(source: string, target: string): Promise<boolean> {
  if (source === target || source.toLowerCase() !== target.toLowerCase()) return false;
  const [a, b] = await Promise.all([present(source), present(target)]);
  return a !== null && b !== null && a.dev === b.dev && a.ino === b.ino;
}

/**
 * Validate every operation against the disk as it will look after the earlier operations of the
 * same request: a target that exists (or is already planned) is refused, a missing source too.
 */
async function planInternal(config: ServerConfig, workspace: WorkspaceInfo, input: unknown): Promise<Planned[]> {
  if (workspace.preset === "wiki") throw new ApiError(409, "file_operation_wiki", "Use the wiki tools to change wiki pages.");
  const operations = operationsSchema.parse(input);
  const roots = await clientRoots(config, workspace);
  const created = new Map<string, "file" | "folder">(), removed = new Set<string>();
  const exists = async (location: string) => created.has(location)
    || ![...removed].some((gone) => isPathWithin(gone, location)) && (await present(location)) !== null;
  const kindOf = async (location: string): Promise<"file" | "folder"> => created.get(location) ?? ((await lstat(location)).isDirectory() ? "folder" : "file");
  const identity = async (location: string, kind: "file" | "folder") => {
    const info = await present(location);
    if (!info) return { identity: "planned" };
    if (kind === "file") return { identity: stamp(info) };
    const contents = await survey(location);
    return { identity: `${stamp(info)}|${contents.fingerprint}`, entries: contents.entries, ...(contents.capped ? { entriesCapped: true as const } : {}) };
  };
  const planned: Planned[] = [];
  for (const operation of operations) {
    if (operation.operation === "create_folder" || operation.operation === "delete") {
      // The client's folder or a linked folder itself is never a target (resolveWorkspaceFilePath refuses the root).
      const target = await locate(roots, operation.path);
      if (operation.operation === "create_folder") {
        if (await exists(target.canonical)) throw new ApiError(409, "file_operation_target_exists", `${target.display} already exists. Nothing was changed.`);
        created.set(target.canonical, "folder");
        planned.push({ operation: "create_folder", kind: "folder", to: target.display, target: target.canonical });
        continue;
      }
      if (!await exists(target.canonical)) throw new ApiError(404, "file_operation_missing", `${target.display} does not exist. Nothing was changed.`);
      const kind = await kindOf(target.canonical);
      const { identity: id, ...contents } = await identity(target.canonical, kind);
      removed.add(target.canonical);
      created.delete(target.canonical);
      planned.push({ operation: "delete", kind, from: target.display, source: target.canonical, sourceRoot: target.root, identity: id, ...(kind === "folder" ? contents : {}) });
      continue;
    }
    const source = await locate(roots, operation.from), target = await locate(roots, operation.to);
    if (!await exists(source.canonical)) throw new ApiError(404, "file_operation_missing", `${source.display} does not exist. Nothing was changed.`);
    const caseOnly = operation.operation === "move" && !created.has(target.canonical) && await sameNode(source.canonical, target.canonical);
    if (!caseOnly && await exists(target.canonical)) throw new ApiError(409, "file_operation_target_exists", `${target.display} already exists. This tool never overwrites. Nothing was changed.`);
    if (!caseOnly && isPathWithin(source.canonical, target.canonical)) throw new ApiError(400, "file_operation_into_itself", "A folder cannot be moved or copied into itself. Nothing was changed.");
    const kind = await kindOf(source.canonical);
    const { identity: id, ...contents } = await identity(source.canonical, kind);
    if (operation.operation === "move") { removed.add(source.canonical); created.delete(source.canonical); }
    created.set(target.canonical, kind);
    planned.push({ operation: operation.operation, kind, from: source.display, to: target.display, source: source.canonical, target: target.canonical,
      sourceRoot: source.root, identity: id, ...(caseOnly ? { caseOnly: true as const } : {}),
      ...(kind === "folder" && operation.operation === "copy" ? contents : {}) });
  }
  return planned;
}

/** What the card and the model see: readable paths, never the canonical ones of other folders. */
function publicPlan(plan: Planned[]): PublicFileOperation[] {
  return plan.map(({ source: _source, target: _target, sourceRoot: _root, identity: _identity, caseOnly: _caseOnly, ...visible }) => visible);
}

/** Binds the approval to canonical paths and file identity without exposing either. */
function revisionOf(plan: Planned[]): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export async function planFileOperations(config: ServerConfig, workspace: WorkspaceInfo, input: unknown): Promise<FilePlan> {
  const plan = await planInternal(config, workspace, input);
  return { operations: publicPlan(plan), revision: revisionOf(plan) };
}

/** Recoverable delete: the OS Trash via the desktop host, else `.lawoss-kos/` next to the item. */
async function moveToTrash(config: ServerConfig, item: Planned): Promise<string> {
  if (!item.source || !item.sourceRoot) throw new Error("Incomplete plan.");
  if (config.trashItem) {
    try { await config.trashItem(item.source); return "system"; }
    catch { /* The OS Trash may be unavailable on a network volume: keep the item in the client's own Trash folder. */ }
    if ((await present(item.source)) === null) return "system";
  }
  const inside = relative(item.sourceRoot, item.source);
  const batch = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const destination = join(item.sourceRoot, LAWOSS_TRASH_FOLDER, batch, inside);
  await mkdir(dirname(destination), { recursive: true });
  await rename(item.source, destination);
  const prefix = item.from && item.from.endsWith(inside.split(sep).join("/")) ? item.from.slice(0, item.from.length - inside.length) : "";
  return visibleName(`${prefix}${LAWOSS_TRASH_FOLDER}/${batch}/${inside.split(sep).join("/")}`);
}

async function execute(config: ServerConfig, item: Planned): Promise<string | undefined> {
  if (item.operation === "create_folder" && item.target) { await mkdir(item.target, { recursive: true }); return undefined; }
  if (item.operation === "delete") return moveToTrash(config, item);
  if (!item.source || !item.target) throw new Error("Incomplete plan.");
  await mkdir(dirname(item.target), { recursive: true });
  if (item.operation === "move") await rename(item.source, item.target);
  else await cp(item.source, item.target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  return undefined;
}

/** The disk after the change, not the intention: the report the model passes on to the user. */
async function verified(item: Planned): Promise<boolean> {
  if (item.operation === "delete") return item.source !== undefined && (await present(item.source)) === null;
  if (item.caseOnly && item.source && item.target) {
    const names = await readdir(dirname(item.target));
    return names.includes(basename(item.target)) && !names.includes(basename(item.source));
  }
  const arrived = item.target !== undefined && (await present(item.target)) !== null;
  return item.operation === "move" ? arrived && item.source !== undefined && (await present(item.source)) === null : arrived;
}

/**
 * Re-plan from the current disk and run only when it matches the plan and revision the user approved.
 * Operations run in order; after the first failure the rest do not run.
 */
export async function applyFileOperations(config: ServerConfig, workspace: WorkspaceInfo, input: unknown, approved: unknown, revision: unknown, sessionID?: string): Promise<{ results: FileOperationResult[]; complete: boolean }> {
  if (config.readOnly) throw new ApiError(403, "read_only", "This server is read-only.");
  const plan = await planInternal(config, workspace, input);
  if (JSON.stringify(publicPlan(plan)) !== JSON.stringify(approved) || revisionOf(plan) !== revision)
    throw new ApiError(409, "file_operation_changed", "The files changed after the approval card was shown. Nothing was changed. Ask the user before trying again.");
  return withFileEditorHandoff({ write: true, sessionID }, async () => {
    const results: FileOperationResult[] = [];
    let failed = false;
    for (const item of plan) {
      const visible = publicPlan([item])[0]!;
      if (failed) { results.push({ ...visible, status: "not_run" }); continue; }
      try {
        const trash = await execute(config, item);
        if (!await verified(item)) throw new Error("The change is not visible on disk.");
        results.push({ ...visible, status: "done", ...(trash ? { trash } : {}) });
      } catch (error) {
        failed = true;
        results.push({ ...visible, status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { results, complete: !failed };
  });
}

/**
 * Only the engine's chat credential: its token hash must match this runtime's secret. The client
 * ID alone is a request header (`x-legalwork-client-id`) for ordinary bearer tokens.
 */
async function engineAgent(config: ServerConfig, actor: Actor | undefined): Promise<boolean> {
  if (actor?.type !== "remote" || !actor.clientId?.startsWith("wiki-agent:") || !actor.tokenHash) return false;
  const expected = Buffer.from(createHash("sha256").update(await ensureWikiAgentToken(config)).digest("hex"));
  const received = Buffer.from(actor.tokenHash);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function registerFileOperationRoutes(options: {
  routes: Route[]; config: ServerConfig;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBodyLimited: (request: Request, maxBytes: number) => Promise<Record<string, unknown>>;
  requireClientScope: (ctx: RequestContext, scope: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
}) {
  const { routes, config, jsonResponse } = options;
  const route = (suffix: string, action: (workspace: WorkspaceInfo, body: Record<string, unknown>) => Promise<unknown>) =>
    addRoute(routes, "POST", `/workspace/:id/lawoss/files/${suffix}`, "client", async (ctx) => {
      options.requireClientScope(ctx, "collaborator");
      // The approval is the engine card the chat's tool showed; other clients have their own file routes and approvals.
      if (!await engineAgent(config, ctx.actor)) throw new ApiError(403, "file_operation_agent_only", "Only a chat's file tool, after the user's approval, can use this route.");
      const workspace = await options.resolveWorkspace(config, ctx.params.id);
      try { return jsonResponse(await action(workspace, await options.readJsonBodyLimited(ctx.request, 512 * 1024))); }
      catch (error) { if (error instanceof z.ZodError) throw new ApiError(400, "file_operation_input", `Send 1–${MAX_FILE_OPERATIONS} operations: move/copy {from, to}, create_folder/delete {path}.`); throw error; }
    });
  route("plan", async (workspace, body) => planFileOperations(config, workspace, body.operations));
  route("apply", async (workspace, body) => applyFileOperations(config, workspace, body.operations, body.approved, body.revision,
    typeof body.sessionID === "string" ? body.sessionID : undefined));
}
