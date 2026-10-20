import { posix } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { isPathWithin } from "./path-within.js";

/**
 * LAWOSS: one managed engine serves every client folder, so a folder proxy may forward only
 * requests that engine 1.18.29 keeps inside the folder named by `x-opencode-directory`.
 *
 * - `?workspace=` (v1 `workspace-routing.ts`), v2 `location[directory]` / `location[workspace]`
 *   and the `x-opencode-workspace` header (v2 `location.ts`) move the request to another
 *   folder or engine workspace. The app never sends them. `directory` stays: the proxy resolves
 *   it inside the folder.
 * - `/global/event` and v2 `/api/event` stream every folder's events, message content included.
 *   The app listens on `/event`, which the engine filters by the instance directory.
 * - `/sync/*` (whole event table), `/experimental/control-plane/*` (moves sessions),
 *   `/experimental/workspace/*`, `/experimental/session/:id/*` (no ownership check),
 *   `/experimental/project/*`, `/project/:id/directories`, `PATCH /project/:id` and `/pty`,
 *   `/api/pty` (any `cwd`) reach other folders or projects. The app uses none of them.
 */
const foreignRoutes = [
  /^\/(?:global|api)\/event$/,
  /^\/sync(?:\/|$)/,
  /^\/experimental\/(?:control-plane|workspace|project)(?:\/|$)/,
  /^\/experimental\/session\/./,
  /^\/(?:api\/)?pty(?:\/|$)/,
  /^\/project\/[^/]+\/directories$/,
];

export function assertEngineRouteScoped(method: string, path: string, query: URLSearchParams, headers: Headers): void {
  if ([...query.keys()].some((key) => key === "workspace" || key.startsWith("location")) || headers.has("x-opencode-workspace")) {
    throw new ApiError(400, "location_override", "Requests stay in this folder");
  }
  const paths = [path, canonicalPath(path)];
  const patchesProject = method.toUpperCase() === "PATCH" && paths.some((candidate) => /^\/project\/[^/]+$/.test(candidate));
  if (patchesProject || paths.some((candidate) => foreignRoutes.some((route) => route.test(candidate)))) {
    throw new ApiError(403, "engine_route_unscoped", "This engine route is not available for a folder");
  }
}

/** Percent-encoded letters, repeated slashes and dot segments must not slip past the patterns. */
function canonicalPath(path: string): string {
  try {
    return posix.normalize(decodeURIComponent(path)).replace(/\/+$/, "") || "/";
  } catch {
    throw new ApiError(400, "invalid_path", "Invalid engine path");
  }
}

const projectSchema = z.object({ id: z.string(), worktree: z.string(), sandboxes: z.array(z.string()).optional() }).passthrough();

/**
 * `GET /project` lists every engine project, so the worktree of every client with git. A folder
 * sees its own project (for a folder without git the global project rooted at `/`) and projects
 * inside the folder; their sandboxes are limited to the folder as well.
 */
export function scopeProjectList(body: unknown, current: { id: string }, roots: readonly string[]): unknown[] {
  const projects = projectSchema.array().safeParse(body);
  if (!projects.success) throw new ApiError(502, "opencode_invalid_response", "Invalid project list");
  const within = (directory: string) => roots.some((root) => isPathWithin(root.normalize("NFC"), directory.normalize("NFC")));
  return projects.data
    .filter((project) => project.id === current.id || within(project.worktree))
    .map((project) => (project.sandboxes ? { ...project, sandboxes: project.sandboxes.filter(within) } : project));
}
