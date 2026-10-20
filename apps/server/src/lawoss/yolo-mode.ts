import { z } from "zod";
import { ApiError } from "../errors.js";
import { appliedOrgPolicy } from "../org-policy.js";
import { addRoute, type Route } from "../routes/registry.js";
import { GLOBAL_TOOL_PERMISSIONS_ID, readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";

/**
 * „YOLO Mode" (owner decision MČ 20. 10. 2026): the agent moves, renames, edits,
 * deletes and runs commands without asking.
 *
 * Stored per device as a flag in the global tool-permission row, which the
 * native Settings → Safety panel already owns (upstream keeps tool permissions
 * as one device-wide posture). The lawyer's own rules in that row are never
 * rewritten: the overlay applies only where permissions take effect (the
 * engine config file and the managed shell), so switching off restores the
 * previous behaviour exactly. Writes to the row already rebuild the engine
 * config file and abort running managed commands.
 *
 * Off by default; a damaged value counts as off. A firm that manages tool
 * permissions (`tools.permissions`) locks it off. AI boundaries are a
 * separate gate and keep refusing model transfer.
 */
export type YoloMode = { enabled: boolean; locked: boolean; source: "default" | "user" | "organization" };

/** Device-wide, never per client: one engine config file serves every client folder. */
const YOLO_RULES = { edit: "allow", bash: "allow", external_directory: { "*": "allow" } } as const;

export async function readYoloMode(config: ServerConfig): Promise<YoloMode> {
  // Any firm rule for tools is a minimum the member cannot loosen, so YOLO stays off.
  if (await appliedOrgPolicy(config, "tools.permissions")) return { enabled: false, locked: true, source: "organization" };
  const row = await readRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID);
  return row.lawossYolo?.enabled === true ? { enabled: true, locked: false, source: "user" } : { enabled: false, locked: false, source: "default" };
}

export async function yoloModeActive(config: ServerConfig): Promise<boolean> {
  return (await readYoloMode(config)).enabled;
}

export async function writeYoloMode(config: ServerConfig, enabled: boolean): Promise<YoloMode> {
  if (enabled && (await readYoloMode(config)).locked)
    throw new ApiError(409, "yolo_mode_locked", "Your organization manages tool permissions, so YOLO Mode is unavailable.");
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, (current) => {
    const next = { ...current };
    // Off removes the flag, so the row is exactly what it was before.
    if (enabled) next.lawossYolo = { enabled: true };
    else delete next.lawossYolo;
    return next;
  });
  return readYoloMode(config);
}

/**
 * The permission map in effect: unchanged while off; while on, edits, commands
 * and folders outside the project are allowed. Internet access keeps the
 * lawyer's rule. The allows go last, because the engine applies the last
 * matching rule.
 */
export function applyYoloPermissions(permission: Record<string, unknown>, enabled: boolean): Record<string, unknown> {
  if (!enabled) return permission;
  const next = { ...permission };
  for (const key of Object.keys(YOLO_RULES)) delete next[key];
  return { ...next, edit: YOLO_RULES.edit, bash: YOLO_RULES.bash, external_directory: { ...YOLO_RULES.external_directory } };
}

/** The managed shell's whole-command folder rule while YOLO Mode is on. */
export function yoloExternalDirectory(): Record<string, unknown> {
  return { ...YOLO_RULES.external_directory };
}

export function registerYoloModeRoutes(options: { routes: Route[]; config: ServerConfig;
  jsonResponse: (value: unknown, status?: number) => Response;
  readJsonBodyLimited: (request: Request, maxBytes: number) => Promise<Record<string, unknown>> }) {
  const { routes, config, jsonResponse } = options;
  addRoute(routes, "GET", "/lawoss/yolo", "client", async () => jsonResponse(await readYoloMode(config)));
  addRoute(routes, "PUT", "/lawoss/yolo", "host-token", async (ctx) => {
    if (config.readOnly) throw new ApiError(403, "read_only", "This server is read-only.");
    const parsed = z.strictObject({ enabled: z.boolean() }).safeParse(await options.readJsonBodyLimited(ctx.request, 1024));
    if (!parsed.success) throw new ApiError(400, "invalid_yolo_mode", "Send only whether YOLO Mode is on.");
    return jsonResponse(await writeYoloMode(config, parsed.data.enabled));
  });
}
