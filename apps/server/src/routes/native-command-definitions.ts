import { ApiError } from "../errors.js";
import { createEngineClient, workspaceEngineLocation } from "../engine-client.js";
import { assertNativeProxyDirectory } from "../native-proxy-policy.js";
import { buildLegalworkRuntimeSettings } from "../legalwork-runtime-config.js";
import { encodeCommandDefinitions, resolveNativeCommandDefinitions } from "../native-command-definitions.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";
import { externalOpencodeConfigDir } from "../lawoss/workspace-app-files.js";

export function registerNativeCommandDefinitionRoutes(options: {
  routes: Route[]; config: ServerConfig;
  jsonResponse: (data: unknown, status?: number) => Response;
  requireClientScope: (ctx: RequestContext, scope: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
}) {
  addRoute(options.routes, "GET", "/workspace/:id/commands/definitions", "client", async ctx => {
    options.requireClientScope(ctx, "collaborator");
    const workspace = await options.resolveWorkspace(options.config, ctx.params.id);
    const root = workspaceEngineLocation(workspace).directory;
    const directories = ctx.url.searchParams.getAll("directory");
    if (directories.length > 1) throw new ApiError(400, "ambiguous_location", "Specify one project directory.");
    const location = { directory: await assertNativeProxyDirectory(root, directories[0] ?? root) };
    await options.config.waitForManagedEngineEndpoint?.();
    const client = createEngineClient(options.config, workspace);
    // Do not prime model.list here. The native command plugin calls this read
    // while model.list is activating plugins; waiting for it would deadlock.
    const [entries, managed] = await Promise.all([
      client.config.get({ location }),
      buildLegalworkRuntimeSettings(options.config, workspace.id),
    ]);
    // LAWOSS: an outside client's commands live in its external .opencode folder, never in the engine's shared root.
    const external = externalOpencodeConfigDir(options.config, workspace);
    const result = encodeCommandDefinitions(await resolveNativeCommandDefinitions(external ? [{ type: "directory", path: external }, ...entries] : entries, managed.configuration.commands));
    const response = options.jsonResponse(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
