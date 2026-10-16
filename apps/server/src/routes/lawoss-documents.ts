import { z } from "zod";
import { ApiError } from "../errors.js";
import { DocumentExports, exportInputSchema, validateInputSchema } from "../lawoss/documents/export.js";
import { LawossDocuments } from "../lawoss/documents/service.js";
import { isSensitiveWorkspacePath, resolveWorkspaceFilePath, viewerProtectedPaths } from "../lawoss/filesystem-boundary.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

export function registerLawossDocumentRoutes(options: {
  routes: Route[]; config: ServerConfig; documents: LawossDocuments;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBodyLimited: (request: Request, maxBytes: number) => Promise<Record<string, unknown>>;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, scope: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
}) {
  const { routes, config, documents, jsonResponse } = options;
  const exports = new DocumentExports(documents);
  const base = "/workspace/:id/lawoss/documents";
  // Viewer does not get prepared text of protected configuration or its aliases.
  const hiddenFrom = async (ctx: RequestContext, workspace: WorkspaceInfo): Promise<(path: string) => Promise<boolean>> => {
    const scope = ctx.actor?.scope ?? (ctx.actor?.type === "host" ? "owner" : "viewer");
    if (scope !== "viewer") return async () => false;
    const isProtected = await viewerProtectedPaths(workspace.path);
    return path => resolveWorkspaceFilePath(workspace.path, path).then(location => isProtected(location, path), () => isSensitiveWorkspacePath(path));
  };
  const route = (method: string, path: string, action: (ctx: RequestContext, workspace: WorkspaceInfo) => Promise<unknown>) => {
    addRoute(routes, method, path, "client", async ctx => {
      if (method !== "GET") { options.ensureWritable(config); options.requireClientScope(ctx, "collaborator"); }
      const workspace = await options.resolveWorkspace(config, ctx.params.id);
      try { return jsonResponse(await action(ctx, workspace)); }
      catch (error) { if (error instanceof z.ZodError) throw new ApiError(400, "documents_input", "Provide bounded document paths, IDs and offsets."); throw error; }
    });
  };
  route("GET", base, async (ctx, workspace) => {
    const url = new URL(ctx.request.url);
    const offset = z.coerce.number().int().min(0).max(500).parse(url.searchParams.get("offset") ?? 0);
    const limit = z.coerce.number().int().min(1).max(50).parse(url.searchParams.get("limit") ?? 50);
    const hidden = await hiddenFrom(ctx, workspace), all = await documents.list(workspace);
    const hide = await Promise.all(all.map(record => hidden(record.provenance.sourcePath)));
    const records = all.filter((_, index) => !hide[index]), end = Math.min(records.length, offset + limit);
    return { documents: records.slice(offset, end), nextOffset: end < records.length ? end : null, untrusted: true };
  });
  route("POST", `${base}/prepare`, async (ctx, workspace) => {
    const body = z.strictObject({ paths: z.array(z.string().min(1).max(4096)).min(1).max(20) }).parse(await options.readJsonBodyLimited(ctx.request, 100 * 1024));
    return { documents: await documents.prepare(workspace, body.paths), untrusted: true };
  });
  route("GET", `${base}/:document/read`, async (ctx, workspace) => {
    const url = new URL(ctx.request.url);
    const offset = z.coerce.number().int().nonnegative().parse(url.searchParams.get("offset") ?? 0);
    const limit = z.coerce.number().int().min(1).max(16000).parse(url.searchParams.get("limit") ?? 16000);
    const hidden = await hiddenFrom(ctx, workspace), document = await documents.read(workspace, ctx.params.document, offset, limit);
    if (await hidden(document.provenance.sourcePath)) throw new ApiError(403, "forbidden", "Configuration and credential files require collaborator access");
    return document;
  });
  route("GET", `${base}/outputs`, async (ctx, workspace) => {
    const url=new URL(ctx.request.url);
    return exports.list(workspace,z.coerce.number().int().min(0).max(500).parse(url.searchParams.get("offset")??0),z.coerce.number().int().min(1).max(20).parse(url.searchParams.get("limit")??20));
  });
  route("POST", `${base}/export`, async (ctx, workspace) => exports.export(workspace, exportInputSchema.parse(await options.readJsonBodyLimited(ctx.request, 300 * 1024))));
  route("POST", `${base}/validate`, async (ctx, workspace) => exports.validate(workspace, validateInputSchema.parse(await options.readJsonBodyLimited(ctx.request, 100 * 1024))));
  route("DELETE", `${base}/:document`, async (ctx, workspace) => documents.cancel(workspace, z.string().uuid().parse(ctx.params.document)));
}
