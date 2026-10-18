import { eventDraftTimes, renderEventDraft } from "../calendar-event-drafts/ics.js";
import { z } from "zod";
import { CalendarEventDraftInputSchema, CalendarEventDraftSchema } from "../calendar-event-drafts/schema.js";
import { ApiError } from "../errors.js";
import { draftPaths, readDraft, saveDraftFiles, editableDraftMetadata } from "../email-drafts/store.js";
import { recordAudit } from "../audit.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";
import type { ApprovalRequest, ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";

export function registerCalendarEventDraftRoutes(options: {
  routes: Route[]; config: ServerConfig;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBodyLimited: (request: Request, maxBytes: number) => Promise<Record<string, unknown>>;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, scope: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  requireApproval: (ctx: RequestContext, input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">) => Promise<void>;
}) {
  const route = (method: string, suffix: string, action: (ctx: RequestContext, workspace: WorkspaceInfo) => Promise<unknown>) => {
    addRoute(options.routes, method, `/workspace/:id/calendar-drafts${suffix}`, "client", async ctx => {
      options.requireClientScope(ctx, method === "GET" ? "viewer" : "collaborator");
      if (method !== "GET") options.ensureWritable(options.config);
      const workspace = await options.resolveWorkspace(options.config, ctx.params.id);
      try { return options.jsonResponse(await action(ctx, workspace)); }
      catch (error) {
        if (error instanceof z.ZodError) throw new ApiError(400, "calendar_draft_input", "Check the event fields.", { issues: error.issues });
        throw error;
      }
    });
  };
  route("GET", "/:draft", async (ctx, workspace) => {
    const draft = CalendarEventDraftSchema.parse(await readDraft(workspace.path, ctx.params.draft, "calendar"));
    if (draft.workspaceId !== workspace.id) throw new ApiError(404, "calendar_draft_missing", "Calendar event draft not found.");
    return { draft };
  });
  for (const method of ["POST", "PUT"]) route(method, method === "POST" ? "" : "/:draft", async (ctx, workspace) => {
    const body = await options.readJsonBodyLimited(ctx.request, 2_100_000);
    const input = CalendarEventDraftInputSchema.parse(body);
    const previous = method === "PUT" ? { id: z.uuid().parse(ctx.params.draft), revision: z.uuid().parse(body.revision) } : undefined;
    const paths = previous ? await draftPaths(workspace.path, previous.id, "calendar") : null;
    await options.requireApproval(ctx, { workspaceId: workspace.id, action: "workspace.file.write", summary: "Save calendar event draft", paths: paths ? [paths.artifact, paths.metadata] : [workspace.path + "/.legalwork/calendar-drafts"] });
    const draft = await saveDraftFiles(workspace.path, workspace.id, "calendar", async (id, current) => {
      const sequence = current ? CalendarEventDraftSchema.parse(current).sequence + 1 : 0;
      const googleCalendar = current ? CalendarEventDraftSchema.parse(current).googleCalendar : undefined;
      return { input: { ...input, ...editableDraftMetadata(current), ...(googleCalendar ? { googleCalendar } : {}), ...eventDraftTimes(input), sequence }, content: renderEventDraft(input, id, sequence) };
    }, previous);
    await recordAudit(workspace.path, { id: draft.revision, workspaceId: workspace.id, actor: ctx.actor ?? { type: "remote" }, action: "workspace.file.write", target: draft.path, summary: "Saved calendar event draft", timestamp: draft.updatedAt });
    return { draft };
  });
}
