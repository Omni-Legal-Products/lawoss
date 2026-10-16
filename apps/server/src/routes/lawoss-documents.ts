import { z } from "zod";
import { ApiError } from "../errors.js";
import { DocumentExports, exportInputSchema, validateInputSchema } from "../lawoss/documents/export.js";
import { LawossDocuments } from "../lawoss/documents/service.js";
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
    const records = await documents.list(workspace), end = Math.min(records.length, offset + limit);
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
    return documents.read(workspace, ctx.params.document, offset, limit);
  });
  route("GET", `${base}/outputs`, async (ctx, workspace) => {
    const url=new URL(ctx.request.url);
    return exports.list(workspace,z.coerce.number().int().min(0).max(500).parse(url.searchParams.get("offset")??0),z.coerce.number().int().min(1).max(20).parse(url.searchParams.get("limit")??20));
  });
  route("POST", `${base}/export`, async (ctx, workspace) => exports.export(workspace, exportInputSchema.parse(await options.readJsonBodyLimited(ctx.request, 300 * 1024))));
  route("POST", `${base}/validate`, async (ctx, workspace) => exports.validate(workspace, validateInputSchema.parse(await options.readJsonBodyLimited(ctx.request, 100 * 1024))));
  route("DELETE", `${base}/:document`, async (ctx, workspace) => documents.cancel(workspace, z.string().uuid().parse(ctx.params.document)));
}
