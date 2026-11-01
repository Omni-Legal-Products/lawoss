import { z } from "zod";
import { ApiError } from "../errors.js";
import { appliedOrgPolicy } from "../org-policy.js";
import { addRoute, type Route } from "../routes/registry.js";
import { GLOBAL_TOOL_PERMISSIONS_ID, readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { CHAT_AGENT } from "./linked-folders-rules.js";

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

/** Device-wide, never per client: one engine config file serves every client folder. The folder
 * rule stays a bare `*` key, which the linked-folders plugin leaves in place; for the chat agent's
 * engine rule it is „ask“, answered by the plugin (`yoloPermissions`). */
const YOLO_TOOLS = ["edit", "bash", "external_directory"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * YOLO removes asking, never a prohibition. A tool the lawyer forbade outright (`deny`, or a
 * `*` denial) keeps its rule; otherwise the tool is allowed and the lawyer's denied patterns
 * follow the allow, so they still win (the engine applies the last matching rule).
 */
function yoloRule(own: unknown, tool: (typeof YOLO_TOOLS)[number]): unknown {
  if (own === "deny" || (isRecord(own) && own["*"] === "deny")) return own;
  const denied = isRecord(own) ? Object.entries(own).filter(([pattern, action]) => pattern !== "*" && action === "deny") : [];
  if (!denied.length && tool !== "external_directory") return "allow";
  return { "*": "allow", ...Object.fromEntries(denied) };
}

/** The allow rules while YOLO Mode is on, derived from the rules in effect (the managed shell's own read). */
function yoloRules(permission: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(YOLO_TOOLS.map((tool) => [tool, yoloRule(permission[tool], tool)]));
}

/**
 * The chat agent's engine rules while YOLO Mode is on. Folders outside the chat still ask the engine
 * (owner decision MČ 31. 10. 2026): the linked-folders plugin answers „once“ for this agent without a
 * card, except a folder of another client or one holding other clients' folders, which keeps its card
 * with a warning. A tool the lawyer forbade or allowed outright keeps that rule; denied patterns follow.
 */
export function yoloPermissions(permission: Record<string, unknown>): Record<string, unknown> {
  const rules = yoloRules(permission);
  const folders = rules.external_directory;
  const own = permission.external_directory;
  const allowedOutright = own === "allow" || (isRecord(own) && own["*"] === "allow");
  if (!isRecord(folders) || folders["*"] !== "allow" || allowedOutright) return rules;
  return { ...rules, external_directory: { ...folders, "*": "ask" } };
}

/**
 * The managed shell's whole-command folder check reads the agent's engine rules too. While YOLO Mode
 * is on, the chat agent's folder „ask“ rules there exist only for the plugin (before, YOLO's trailing
 * `*` allow overrode them, scoped ones included), so the shell skips them and keeps the YOLO allow;
 * denials still apply. Other agents keep their rules.
 */
export function yoloShellAgentRules<T extends { permission: string; pattern: string; action: string }>(rules: T[], agent: string | undefined, enabled: boolean): T[] {
  if (!enabled || agent !== CHAT_AGENT) return rules;
  return rules.filter((rule) => !(rule.permission === "external_directory" && rule.action === "ask"));
}

const LOCKED: YoloMode = { enabled: false, locked: true, source: "organization" };

export async function readYoloMode(config: ServerConfig): Promise<YoloMode> {
  const row = await readRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID);
  // Any firm rule for tools is a minimum the member cannot loosen, so YOLO stays off. A flag saved
  // earlier is cleared, so releasing the policy later never turns YOLO on without a new confirmation.
  if (await appliedOrgPolicy(config, "tools.permissions")) {
    if (row.lawossYolo) await clearYoloFlag(config);
    return LOCKED;
  }
  return row.lawossYolo?.enabled === true ? { enabled: true, locked: false, source: "user" } : { enabled: false, locked: false, source: "default" };
}

export async function yoloModeActive(config: ServerConfig): Promise<boolean> {
  return (await readYoloMode(config)).enabled;
}

export async function writeYoloMode(config: ServerConfig, enabled: boolean): Promise<YoloMode> {
  if (enabled && (await readYoloMode(config)).locked)
    throw new ApiError(409, "yolo_mode_locked", "Your organization manages tool permissions, so YOLO Mode is unavailable.");
  if (enabled) await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, (current) => ({ ...current, lawossYolo: { enabled: true } }));
  else await clearYoloFlag(config);
  return readYoloMode(config);
}

// Off removes the flag, so the row is exactly what it was before.
async function clearYoloFlag(config: ServerConfig): Promise<void> {
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, (current) => {
    const next = { ...current };
    delete next.lawossYolo;
    return next;
  });
}

/**
 * The managed shell's own permission read: unchanged while off; while on, the YOLO rules
 * replace edits, commands and folders at the end of the map. Internet access keeps the
 * lawyer's rule. The engine gets the same rules on the chat agent only.
 */
export function applyYoloPermissions(permission: Record<string, unknown>, enabled: boolean): Record<string, unknown> {
  if (!enabled) return permission;
  const rules = yoloRules(permission);
  const next = { ...permission };
  for (const tool of YOLO_TOOLS) delete next[tool];
  return { ...next, ...rules };
}

/** The managed shell's whole-command folder rule while YOLO Mode is on (the workspace's own denials kept). */
export function yoloExternalDirectory(workspace: Record<string, unknown>): Record<string, unknown> {
  const rule = yoloRule(workspace, "external_directory");
  return isRecord(rule) ? rule : { "*": "allow" };
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
