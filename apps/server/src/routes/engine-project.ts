import { engineProjectStatus } from "../engine-project.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

export function registerEngineProjectRoutes(options: {
  routes: Route[]; config: ServerConfig;
  jsonResponse: (data: unknown, status?: number) => Response;
  requireClientScope: (ctx: RequestContext, scope: TokenScope) => void;
  ensureWritable: (config: ServerConfig) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  onRetry?: (workspace: WorkspaceInfo) => Promise<void>;
}) {
  addRoute(options.routes, "GET", "/workspace/:id/engine-project", "client", async ctx => {
    const workspace = await options.resolveWorkspace(options.config, ctx.params.id);
    const response = options.jsonResponse(await engineProjectStatus(options.config, workspace));
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
  addRoute(options.routes, "POST", "/workspace/:id/engine-project/retry-recovery", "client", async ctx => {
    options.requireClientScope(ctx, "collaborator");
    options.ensureWritable(options.config);
    const workspace = await options.resolveWorkspace(options.config, ctx.params.id);
    await options.onRetry?.(workspace);
    await options.config.retryManagedEngineRecovery?.();
    const response = options.jsonResponse(await engineProjectStatus(options.config, workspace));
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
  // 🟡 LAWOSS #477: "Try again" in the status bar while the managed engine is down.
  addRoute(options.routes, "POST", "/engine/restart", "client", async ctx => {
    options.requireClientScope(ctx, "collaborator");
    options.ensureWritable(options.config);
    const restarting = options.config.retryManagedEngineRestart?.() ?? false;
    const response = options.jsonResponse({ restarting, engine: { status: options.config.managedEngineStatus ?? "ready" } });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
