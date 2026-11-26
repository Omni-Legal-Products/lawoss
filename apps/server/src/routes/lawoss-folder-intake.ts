import { z } from "zod";
import { ApiError } from "../errors.js";
import type { FolderIntakes } from "../lawoss/folder-intake.js";
import { registerCaseSchema } from "../lawoss/register-case.js";
import type { ServerConfig } from "../types.js";
import { addRoute, type Route } from "./registry.js";

export function registerFolderIntakeRoutes(routes: Route[], config: ServerConfig, intake: FolderIntakes,
  jsonResponse: (data: unknown) => Response, readBody: (request: Request, limit: number) => Promise<Record<string, unknown>>) {
  addRoute(routes, "POST", "/workspace/:id/lawoss/folder-intake/search", "host-token", async ctx => {
    const workspace = config.workspaces.find(w => w.id === ctx.params.id);
    if (!workspace || ctx.actor?.type !== "host") throw new ApiError(403, "intake_host", "Local client required.");
    const request = z.strictObject({run:z.uuid(), query:z.string().trim().min(1).max(200)}).safeParse(await readBody(ctx.request, 2048));
    if (!request.success) throw new ApiError(400, "intake_search", "Enter a search term.");
    return jsonResponse(await intake.search(workspace, request.data.run, request.data.query));
  });
  const input = z.discriminatedUnion("action", [
    z.strictObject({ action: z.enum(["open", "refresh"]) }),
    z.strictObject({ action: z.literal("save"), run: z.uuid(), cases: z.array(registerCaseSchema.omit({ operation: true })).max(100) }),
  ]);
  addRoute(routes, "POST", "/workspace/:id/lawoss/folder-intake", "host-token", async ctx => {
    if (ctx.actor?.type !== "host") throw new ApiError(403, "intake_host", "Client intake requires the local host.");
    const workspace = config.workspaces.find(w => w.id === ctx.params.id);
    if (!workspace) throw new ApiError(404, "workspace_missing", "Client not found.");
    const parsed = input.safeParse(await readBody(ctx.request, 256 * 1024));
    if (!parsed.success) throw new ApiError(400, "intake_input", "Invalid client intake request.");
    const data = parsed.data;
    const state = data.action === "save" ? await intake.save(workspace, data.run, data.cases) : intake.start(workspace, data.action === "refresh");
    return jsonResponse(state.state === "scanning" ? { ...state, sources: [] } : state);
  });
}
