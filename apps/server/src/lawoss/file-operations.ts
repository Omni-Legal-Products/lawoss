/**
 * LAWOSS: premenovanie, presun, kópia, nový priečinok a zmazanie s jednou čitateľnou kartou (alfa 2, MČ 22. 10. 2026).
 *
 * Nástroj `lawoss_files` (plugin `lawoss-file-operations.ts`) sa najprv opýta servera na plán
 * (kanonické cesty, čitateľné „pôvodná → nová“), potom požiada engine o povolenie `edit` jednou
 * kartou s celým plánom (`context.ask`) a až po schválení pošle ten istý plán na vykonanie.
 * Server plán pred vykonaním zostaví znova: ak sa medzitým zmenil disk, nič nevykoná (409).
 *
 * Hranica: koreň klienta a jeho pripojené priečinky podľa tých istých pravidiel ako sandbox
 * (`linkableFolders`). Cudzí priečinok sa odmietne bez mena klienta, ktorému patrí. Nič sa
 * neprepíše: existujúci cieľ je chyba. Výsledok hlási skutočný stav disku (`lstat` po zmene).
 */
import { cp, lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, relative } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { withFileEditorHandoff } from "../file-editor-handoff.js";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory } from "../runtime-opencode-config-store.js";
import { authorizedFolders } from "../agent-sandbox/service.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
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
const operationsSchema = z.array(fileOperationSchema).min(1).max(MAX_FILE_OPERATIONS);

/** One planned change, as the card shows it (`from`/`to` relative to the client or linked folder). */
export type PlannedFileOperation = {
  operation: FileOperation["operation"];
  kind: "file" | "folder";
  from?: string;
  to?: string;
  /** Items inside a folder that is deleted or copied (bounded). */
  entries?: number;
  source?: string;
  target?: string;
};
export type FileOperationResult = PlannedFileOperation & { status: "done" | "failed" | "not_run"; error?: string };

const OUTSIDE = "This path is not in this client's folder or in a folder linked to this client. Nothing was changed. The user can link a folder that belongs to this client on the client's overview.";

type Root = { path: string; label: string | null };

async function clientRoots(config: ServerConfig, workspace: WorkspaceInfo): Promise<Root[]> {
  const linked = await linkableFolders(config, workspace, authorizedFolders(runtimeExternalDirectory(await readRuntimeOpencodeConfig(config, workspace.id))));
  return [{ path: workspace.path, label: null }, ...linked.map((folder) => ({ path: folder, label: basename(folder) }))];
}

type Located = { canonical: string; display: string };

/** The canonical path in the client's folder or a linked folder; a link itself is moved or deleted, not its target. */
async function locate(roots: Root[], requested: string): Promise<Located> {
  for (const root of roots) {
    const canonical = await resolveWorkspaceFilePath(root.path, requested, { preserveLeaf: true }).catch(() => null);
    if (!canonical) continue;
    const canonicalRoot = await resolveWorkspaceFilePath(root.path, ".", { allowRoot: true });
    const inside = relative(canonicalRoot, canonical);
    if (isSensitiveWorkspacePath(inside) || inside.split(/[\\/]/).includes(".git"))
      throw new ApiError(403, "file_operation_protected", "This path holds app or version-control configuration and cannot be changed with this tool. Nothing was changed.");
    return { canonical, display: root.label ? `${root.label}/${inside}` : inside };
  }
  throw new ApiError(403, "file_operation_outside_client", OUTSIDE);
}

async function present(location: string) {
  return lstat(location).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
}

async function countEntries(folder: string, limit = 1000): Promise<number> {
  let count = 0;
  const pending = [folder];
  while (pending.length && count < limit) {
    const entries = await readdir(pending.pop() ?? folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      count++;
      if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(`${entry.parentPath}/${entry.name}`);
    }
  }
  return Math.min(count, limit);
}

/**
 * Validate every operation against the disk as it will look after the earlier operations of the
 * same request: a target that exists (or is already planned) is refused, a missing source too.
 */
export async function planFileOperations(config: ServerConfig, workspace: WorkspaceInfo, input: unknown): Promise<PlannedFileOperation[]> {
  if (workspace.preset === "wiki") throw new ApiError(409, "file_operation_wiki", "Use the wiki tools to change wiki pages.");
  const operations = operationsSchema.parse(input);
  const roots = await clientRoots(config, workspace);
  const created = new Map<string, "file" | "folder">(), removed = new Set<string>();
  const exists = async (location: string) => created.has(location)
    || ![...removed].some((gone) => isPathWithin(gone, location)) && (await present(location)) !== null;
  const kindOf = async (location: string): Promise<"file" | "folder"> => created.get(location) ?? ((await lstat(location)).isDirectory() ? "folder" : "file");
  const planned: PlannedFileOperation[] = [];
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
      removed.add(target.canonical);
      created.delete(target.canonical);
      planned.push({ operation: "delete", kind, from: target.display, source: target.canonical, ...(kind === "folder" ? { entries: await countEntries(target.canonical) } : {}) });
      continue;
    }
    const source = await locate(roots, operation.from), target = await locate(roots, operation.to);
    if (!await exists(source.canonical)) throw new ApiError(404, "file_operation_missing", `${source.display} does not exist. Nothing was changed.`);
    if (await exists(target.canonical)) throw new ApiError(409, "file_operation_target_exists", `${target.display} already exists. This tool never overwrites. Nothing was changed.`);
    if (isPathWithin(source.canonical, target.canonical)) throw new ApiError(400, "file_operation_into_itself", "A folder cannot be moved or copied into itself. Nothing was changed.");
    const kind = await kindOf(source.canonical);
    if (operation.operation === "move") { removed.add(source.canonical); created.delete(source.canonical); }
    created.set(target.canonical, kind);
    planned.push({ operation: operation.operation, kind, from: source.display, to: target.display, source: source.canonical, target: target.canonical,
      ...(kind === "folder" && operation.operation === "copy" ? { entries: await countEntries(source.canonical) } : {}) });
  }
  return planned;
}

/** What the card and the model see: readable paths, never the canonical ones of other folders. */
export function publicPlan(plan: PlannedFileOperation[]) {
  return plan.map(({ source: _source, target: _target, ...visible }) => visible);
}

async function execute(item: PlannedFileOperation): Promise<void> {
  if (item.operation === "create_folder" && item.target) { await mkdir(item.target, { recursive: true }); return; }
  if (item.operation === "delete" && item.source) { await rm(item.source, { recursive: item.kind === "folder", force: false }); return; }
  if (!item.source || !item.target) throw new Error("Incomplete plan.");
  await mkdir(dirname(item.target), { recursive: true });
  if (item.operation === "move") await rename(item.source, item.target);
  else await cp(item.source, item.target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
}

/** The disk after the change, not the intention: the report the model passes on to the user. */
async function verified(item: PlannedFileOperation): Promise<boolean> {
  if (item.operation === "delete") return item.source !== undefined && (await present(item.source)) === null;
  const arrived = item.target !== undefined && (await present(item.target)) !== null;
  return item.operation === "move" ? arrived && item.source !== undefined && (await present(item.source)) === null : arrived;
}

/**
 * Re-plan from the current disk and run only when it matches the plan the user approved.
 * Operations run in order; after the first failure the rest do not run.
 */
export async function applyFileOperations(config: ServerConfig, workspace: WorkspaceInfo, input: unknown, approved: unknown, sessionID?: string): Promise<{ results: FileOperationResult[]; complete: boolean }> {
  if (config.readOnly) throw new ApiError(403, "read_only", "This server is read-only.");
  const plan = await planFileOperations(config, workspace, input);
  if (JSON.stringify(publicPlan(plan)) !== JSON.stringify(approved))
    throw new ApiError(409, "file_operation_changed", "The files changed after the approval card was shown. Nothing was changed. Ask the user before trying again.");
  return withFileEditorHandoff({ write: true, sessionID }, async () => {
    const results: FileOperationResult[] = [];
    let failed = false;
    for (const item of plan) {
      const visible = publicPlan([item])[0];
      if (failed) { results.push({ ...visible, status: "not_run" }); continue; }
      try {
        await execute(item);
        if (!await verified(item)) throw new Error("The change is not visible on disk.");
        results.push({ ...visible, status: "done" });
      } catch (error) {
        failed = true;
        results.push({ ...visible, status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { results, complete: !failed };
  });
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
      const workspace = await options.resolveWorkspace(config, ctx.params.id);
      try { return jsonResponse(await action(workspace, await options.readJsonBodyLimited(ctx.request, 512 * 1024))); }
      catch (error) { if (error instanceof z.ZodError) throw new ApiError(400, "file_operation_input", `Send 1–${MAX_FILE_OPERATIONS} operations: move/copy {from, to}, create_folder/delete {path}.`); throw error; }
    });
  route("plan", async (workspace, body) => ({ operations: publicPlan(await planFileOperations(config, workspace, body.operations)) }));
  route("apply", async (workspace, body) => applyFileOperations(config, workspace, body.operations, body.approved,
    typeof body.sessionID === "string" ? body.sessionID : undefined));
}
