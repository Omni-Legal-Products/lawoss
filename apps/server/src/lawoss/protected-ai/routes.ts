import { z } from "zod";
import { ApiError } from "../../errors.js";
import { addRoute, type Route } from "../../routes/registry.js";
import { protectedGenerationInputSchema, type ProtectedDocumentRuntime } from "./runtime.js";

export function registerProtectedDocumentRoutes(options: { routes: Route[]; runtime: ProtectedDocumentRuntime;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBodyLimited: (request: Request, maximum: number) => Promise<Record<string, unknown>> }) {
  addRoute(options.routes, "POST", "/workspace/:id/lawoss/documents/generation", "host-token", async ctx => {
    try {
      const body = await options.readJsonBodyLimited(ctx.request, 100 * 1024);
      // The route owner is authoritative; a body cannot select another project.
      const input = protectedGenerationInputSchema.omit({ workspaceId: true }).parse(body);
      return options.jsonResponse(await options.runtime.open({ ...input, workspaceId: ctx.params.id }, ctx.request.signal));
    } catch (error) {
      if (error instanceof z.ZodError) throw new ApiError(400, "protected_generation_input", "Select exact current prepared sources, model and optional host-owned profile only.");
      throw error;
    }
  });
}
