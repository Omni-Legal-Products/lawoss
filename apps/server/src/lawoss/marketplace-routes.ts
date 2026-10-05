/**
 * LAWOSS: routes LAWOSS Marketplace (host auth ako `/lawoss/ocr`). Inštalácia pre všetkých
 * klientov, presun doterajšej inštalácie z priečinka, aktualizácie z vydaní marketplace
 * a nastavenie týždennej kontroly. Logika je v `marketplace-global.ts` a `marketplace-updates.ts`.
 *
 * GET  /lawoss/marketplace[?workspaceId=]   stav bez siete: globálne pluginy, inštalácie len v priečinku,
 *                                           nastavenie, posledná kontrola, dostupné aktualizácie
 * POST /lawoss/marketplace/check            { reason: "open" | "manual" } (sieť: GitHub marketplace)
 * PUT  /lawoss/marketplace/settings         { weeklyCheck: boolean }
 * POST /lawoss/marketplace/plugins          { url } inštalácia pre všetkých klientov
 * POST /lawoss/marketplace/plugins/update   { pluginId, resolutions? }
 * POST /lawoss/marketplace/plugins/remove   { pluginId, resolutions? }
 * POST /lawoss/marketplace/plugins/move     { workspaceId, pluginId, url, resolutions? }
 */
import { ApiError } from "../errors.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import {
  availableUpdates,
  installGlobalPlugin,
  isMarketplacePlugin,
  listInstalled,
  moveWorkspacePlugin,
  pluginFileChanges,
  removeGlobalPlugin,
  updateGlobalPlugin,
  workspaceTarget,
  type FileResolution,
} from "./marketplace-global.js";
import { marketplaceStatePath, readUpdateState, runMarketplaceCheck, updateUpdateState } from "./marketplace-updates.js";
import { globalPluginTarget } from "./plugin-install-target.js";
import { workspaceAppFilesRoot } from "./workspace-app-files.js";

const RESOLUTIONS: ReadonlySet<string> = new Set(["keep", "replace", "backup"]);

function readResolutions(value: unknown): Record<string, FileResolution> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, FileResolution> = {};
  for (const [path, choice] of Object.entries(value)) {
    if (typeof choice === "string" && RESOLUTIONS.has(choice) && path.startsWith(".opencode/")) {
      output[path] = choice === "keep" ? "keep" : choice === "replace" ? "replace" : "backup";
    }
  }
  return output;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "invalid_payload", `${field} is required`);
  return value.trim();
}

export function registerLawossMarketplaceRoutes(options: {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBodyLimited: (request: Request, maxBytes: number) => Promise<Record<string, unknown>>;
  ensureWritable: (config: ServerConfig) => void;
  resolveWorkspace: (id: string) => Promise<WorkspaceInfo>;
  /** Po zmene globálnych pluginov: obnova inštancií enginu všetkých lokálnych priečinkov (na pozadí). */
  afterChange: (ctx: RequestContext) => Promise<void>;
}) {
  const { routes, config, jsonResponse, readJsonBodyLimited, ensureWritable } = options;
  const statePath = marketplaceStatePath(config);
  const route = (method: string, path: string, handler: (ctx: RequestContext) => Promise<unknown>) => {
    addRoute(routes, method, path, "host", async (ctx) => {
      if (method !== "GET") ensureWritable(config);
      return jsonResponse(await handler(ctx));
    });
  };
  const body = (ctx: RequestContext) => readJsonBodyLimited(ctx.request, 64 * 1024);

  const view = async (workspaceId: string | null) => {
    const state = await readUpdateState(statePath);
    const global = await listInstalled(config, globalPluginTarget().recordId);
    const globalChanges = Object.fromEntries(await Promise.all(global.map(async (plugin) => [plugin.pluginId, await pluginFileChanges(globalPluginTarget(), plugin)] as const)));
    let workspace: Awaited<ReturnType<typeof listInstalled>> = [];
    if (workspaceId) {
      const info = await options.resolveWorkspace(workspaceId).catch(() => null);
      if (info && info.workspaceType !== "remote") workspace = (await listInstalled(config, info.id)).filter(isMarketplacePlugin);
    }
    return {
      global,
      globalChanges,
      workspace,
      settings: { weeklyCheck: state.weeklyCheck, lastCheckedAt: state.lastCheckedAt },
      check: state.lastCheck,
      updates: availableUpdates(global, state),
    };
  };

  route("GET", "/lawoss/marketplace", async (ctx) => view(ctx.url.searchParams.get("workspaceId")?.trim() || null));

  route("POST", "/lawoss/marketplace/check", async (ctx) => {
    const input = await body(ctx);
    await runMarketplaceCheck(statePath, input.reason === "open" ? "open" : "manual");
    return view(typeof input.workspaceId === "string" ? input.workspaceId : null);
  });

  route("PUT", "/lawoss/marketplace/settings", async (ctx) => {
    const input = await body(ctx);
    if (typeof input.weeklyCheck !== "boolean") throw new ApiError(400, "invalid_payload", "Send weeklyCheck: true or false.");
    const weeklyCheck = input.weeklyCheck;
    const next = await updateUpdateState(statePath, (state) => ({ ...state, weeklyCheck }));
    return { weeklyCheck: next.weeklyCheck, lastCheckedAt: next.lastCheckedAt };
  });

  route("POST", "/lawoss/marketplace/plugins", async (ctx) => {
    const input = await body(ctx);
    const result = await installGlobalPlugin(config, requiredText(input.url, "url"));
    if (result.status === "installed") await options.afterChange(ctx);
    return result;
  });

  route("POST", "/lawoss/marketplace/plugins/update", async (ctx) => {
    const input = await body(ctx);
    const result = await updateGlobalPlugin(config, requiredText(input.pluginId, "pluginId"), await readUpdateState(statePath), readResolutions(input.resolutions));
    if (result.status === "updated") await options.afterChange(ctx);
    return result;
  });

  route("POST", "/lawoss/marketplace/plugins/remove", async (ctx) => {
    const input = await body(ctx);
    const result = await removeGlobalPlugin(config, requiredText(input.pluginId, "pluginId"), readResolutions(input.resolutions));
    if (result.status === "removed") await options.afterChange(ctx);
    return result;
  });

  route("POST", "/lawoss/marketplace/plugins/move", async (ctx) => {
    const input = await body(ctx);
    const workspace = await options.resolveWorkspace(requiredText(input.workspaceId, "workspaceId"));
    if (workspace.workspaceType === "remote") throw new ApiError(400, "remote_workspace", "Plugins in a remote workspace cannot be moved here.");
    const result = await moveWorkspacePlugin(
      config,
      workspaceTarget(workspace.id, workspaceAppFilesRoot(config, workspace)),
      requiredText(input.pluginId, "pluginId"),
      requiredText(input.url, "url"),
      readResolutions(input.resolutions),
    );
    if (result.status === "moved") await options.afterChange(ctx);
    return result;
  });
}
