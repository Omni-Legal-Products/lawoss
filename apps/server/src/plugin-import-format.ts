import { z } from "zod";
import { ApiError } from "./errors.js";

const pluginSchema = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const mcpSchema = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
// Versioned local rules: a package never chooses a schema to download or execute.
const manifest = z.object({
  $schema: z.literal(pluginSchema), name: z.string().min(1).max(64).regex(/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/),
  version: z.string().optional(), description: z.string().optional(),
  author: z.object({ name: z.string().optional(), email: z.string().optional(), url: z.string().optional() }).strict().optional(),
  homepage: z.string().optional(), repository: z.string().optional(), license: z.string().optional(),
  keywords: z.array(z.string()).optional(), extensions: z.unknown().optional(),
});
const remote = { url: z.string().min(1).refine(value => { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !value.includes("${"); } catch { return false; } }), headers: z.record(z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/), z.string().refine(value => !/[\r\n]/.test(value))).optional() };
const entry = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stdio"), command: z.string().min(1).refine(value => !value.includes("${")), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).refine(value => !Object.hasOwn(value, "PLUGIN_ROOT") && !Object.hasOwn(value, "PLUGIN_DATA")).optional(), cwd: z.string().regex(/^(?:\.\/|\$\{PLUGIN_ROOT\}(?:\/|$)|\$\{PLUGIN_DATA\}(?:\/|$))/).optional() }).strict(),
  z.object({ type: z.literal("streamable-http"), ...remote }).strict(),
  z.object({ type: z.literal("sse"), ...remote }).strict(),
]);
export function validatePortableManifest(value: Record<string, unknown>, warnings: string[]) {
  const result = manifest.safeParse(value);
  if (!result.success) throw new ApiError(400, "unsupported_plugin_format", "This portable plugin has an invalid manifest or an unsupported schema version. LegalWork supports Agent Plugins 1.0.0.");
  for (const key of Object.keys(value)) if (!Object.hasOwn(manifest.shape, key)) warnings.push(`Portable plugin field “${key}” is not supported and will be ignored.`);
  return result.data;
}
export function validatePortableMcp(value: Record<string, unknown>): Record<string, unknown> {
  if (value.$schema !== mcpSchema || !value.mcpServers || typeof value.mcpServers !== "object" || Array.isArray(value.mcpServers) || Object.keys(value).some(key => !["$schema", "mcpServers"].includes(key))) throw new ApiError(400, "invalid_portable_mcp", "The portable connector configuration must declare Agent Plugins 1.0.0, an mcpServers object, and no unknown top-level fields.");
  return Object.fromEntries(Object.entries(value.mcpServers));
}
export function portableEntryError(value: Record<string, unknown>): string | undefined {
  return entry.safeParse(value).success ? undefined : "This connector does not follow the Agent Plugins 1.0.0 schema for its declared transport. Correct its command, arguments, environment, working directory or HTTP configuration before importing.";
}
