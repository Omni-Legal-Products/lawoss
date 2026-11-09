/**
 * LAWOSS: konfigurácia enginu pre klienta, ktorého app files sú mimo jeho priečinka (režim outside), rozhodnutie MČ 9. 11. 2026.
 *
 * Engine 2.1.4 má jeden koreň konfigurácie pre celý proces (`OPENCODE_CONFIG_DIR`) a projektovú konfiguráciu číta zo
 * súborov v priečinku lokácie. Koreň je preto vždy neutrálny priečinok politiky firmy a projektová konfigurácia je
 * zapnutá pre všetkých. Do priečinka klienta outside server nič nezapisuje (žiadne `.opencode/opencode.json`), takže
 * nastavenia, skilly, príkazy a inštrukcie tohto klienta doručí len jeho lokáciám plugin `lawoss-outside-config` zo
 * súboru `runtime-opencode-settings.json` a z tejto mapy. Vlastný `opencode.json` alebo `AGENTS.md`, ktorý si klient
 * sám vytvoril, engine prečíta ako pri každom projekte.
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { NativeRuntimeConfiguration } from "../runtime-config-upgrade.js";
import { parseFrontmatter } from "../frontmatter.js";
import { ApiError } from "../errors.js";
import type { OpenCodeClient } from "@opencode/client";

export const OUTSIDE_CLIENTS_FILE = "lawoss-outside-clients.json";

const mapSchema = z.object({
  version: z.literal(1),
  clients: z.array(z.object({ id: z.string(), directory: z.string(), configDirectory: z.string() }).strict()),
}).strict();
export type OutsideClientsMap = z.infer<typeof mapSchema>;
export type OutsideClient = OutsideClientsMap["clients"][number];

export function parseOutsideClientsMap(value: unknown): OutsideClientsMap | null {
  const parsed = mapSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const outsideConfigRpc = {
  id: "lawoss.outside-config",
  methods: { refresh: { input: { type: "object", properties: {}, additionalProperties: false },
    output: { type: "object", properties: { refreshed: { type: "boolean" } }, required: ["refreshed"], additionalProperties: false } } },
  events: {},
} satisfies import("@opencode/schema/rpc").PortableDefinition;

const within = (root: string, path: string) => {
  const suffix = relative(root, path);
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`));
};

/** The external skills folder of an outside client (its app files, never its own folder). */
export const outsideSkillsDirectory = (configDirectory: string) => join(configDirectory, "skills");

/**
 * Configuration for computing what every location shares (runtime-opencode-config.json): an outside client's own
 * external folders never become shared, even when it is the only registered client.
 */
export function shareableConfiguration(configuration: NativeRuntimeConfiguration, configDirectory: string | null): NativeRuntimeConfiguration {
  if (!configDirectory || !configuration.skills) return configuration;
  return { ...configuration, skills: configuration.skills.filter((path) => !within(configDirectory, resolve(path))) };
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export type OutsideDelivery = {
  /** MCP servers of this client the shared file lacks (the shared file carries `mcp` only when all clients agree). */
  mcp: [string, NonNullable<NonNullable<NativeRuntimeConfiguration["mcp"]>["servers"]>[string]][];
  /** Skill folders of this client the shared file lacks. */
  skills: string[];
  /** Configured instruction files of this client the shared file lacks (absolute paths only). */
  instructions: string[];
  /** Agent declarations that differ from the shared ones. */
  agents: [string, NonNullable<NativeRuntimeConfiguration["agents"]>[string]][];
  /** `provider.use` rules of this client, when its policies differ from the shared ones (last match wins). */
  providerPolicies: { resource: string; effect: "allow" | "deny" }[];
  deniedProviders: (provider: string) => boolean;
  defaultAgent?: string;
};

const pattern = (value: string) => new RegExp(`^${value.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);

/** What the native project file would have carried for an outside client beyond the shared file. */
export function outsideDelivery(configuration: NativeRuntimeConfiguration, shared: NativeRuntimeConfiguration): OutsideDelivery {
  const sharedServers = shared.mcp?.servers ?? {};
  const mcp = Object.entries(configuration.mcp?.servers ?? {}).filter(([name, server]) => !same(sharedServers[name], server));
  const skills = (configuration.skills ?? []).filter((path) => !(shared.skills ?? []).includes(path));
  const instructions = (configuration.instructions ?? []).filter((path) => isAbsolute(path) && !(shared.instructions ?? []).includes(path));
  const sharedAgents = shared.agents ?? {};
  const agents = Object.entries(configuration.agents ?? {}).filter(([id, agent]) => !same(sharedAgents[id], agent));
  const policies = same(configuration.policies, shared.policies) ? [] : configuration.policies ?? [];
  const providerPolicies = policies.filter((rule) => rule.action === "provider.use").map(({ resource, effect }) => ({ resource, effect }));
  const providerRules = providerPolicies.map((rule) => ({ ...rule, match: pattern(rule.resource) }));
  const deniedProviders = (provider: string) => [...providerRules].reverse().find((rule) => rule.match.test(provider))?.effect === "deny";
  return { mcp, skills, instructions, agents, providerPolicies, deniedProviders,
    ...(configuration.default_agent && configuration.default_agent !== shared.default_agent ? { defaultAgent: configuration.default_agent } : {}) };
}

export type OutsideSkill = { id: string; name: string; description?: string; autoinvoke?: boolean; path: string; content: string };

const SKILL_SCAN_DEPTH = 6;
const IGNORED = new Set(["node_modules", "dist", "build", "target", "vendor", "bin", "obj", ".git"]);

function flag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(normalized)) return true;
  if (["false", "no", "off", "0"].includes(normalized)) return false;
  return undefined;
}

/** Same discovery as the native skill source (directory scan of engine 2.1.4): a folder with SKILL.md is one skill,
 * Markdown files directly in the root are skills too, hidden folders are skipped, at most six levels deep. */
export async function scanOutsideSkills(root: string): Promise<OutsideSkill[]> {
  const files: string[] = [];
  const queue = [{ directory: root, depth: 0 }];
  for (const item of queue) {
    const entries = await readdir(item.directory, { withFileTypes: true }).catch(() => []);
    const visible = entries.filter((entry) => !entry.name.startsWith(".") && !IGNORED.has(entry.name));
    const skill = visible.find((entry) => entry.isFile() && entry.name === "SKILL.md");
    if (skill) { files.push(join(item.directory, skill.name)); continue; }
    if (item.depth === 0) files.push(...visible.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => join(item.directory, entry.name)));
    if (item.depth < SKILL_SCAN_DEPTH) queue.push(...visible.filter((entry) => entry.isDirectory()).map((entry) => ({ directory: join(item.directory, entry.name), depth: item.depth + 1 })));
  }
  const skills: OutsideSkill[] = [];
  for (const file of files.sort()) {
    const text = await readFile(file, "utf8").catch(() => undefined);
    if (!text) continue;
    let parsed: ReturnType<typeof parseFrontmatter>;
    try { parsed = parseFrontmatter(text); } catch { continue; }
    const id = dirname(file) === root && basename(file) !== "SKILL.md" ? basename(file, ".md") : basename(dirname(file));
    const { name, description, metadata } = parsed.data;
    const autoinvoke = (metadata && typeof metadata === "object" && "opencode/autoinvoke" in metadata ? flag(metadata["opencode/autoinvoke"]) : undefined)
      ?? (flag(parsed.data["disable-model-invocation"]) ? false : undefined);
    skills.push({ id, name: typeof name === "string" ? name : id, ...(typeof description === "string" ? { description } : {}),
      ...(autoinvoke === undefined ? {} : { autoinvoke }), path: file, content: parsed.body });
  }
  return skills;
}

/**
 * After a configuration publication: an outside client has no watched project file, so its location re-reads its
 * settings explicitly (`lawoss.outside-config`). Inside clients rely on the engine's native file watching as before.
 * An RPC of a plugin that is not active would wait instead of failing, so the plugin state is checked first.
 */
export async function refreshOutsideEngineLocation(client: OpenCodeClient, outside: boolean, directory: string): Promise<void> {
  if (!outside) return;
  const location = { directory };
  const plugins = (await client.plugin.list({ location })).data;
  if (!plugins.some((plugin) => plugin.id === outsideConfigRpc.id && plugin.state.status === "active"))
    throw new ApiError(503, "outside_settings_unavailable", "The settings of this client are not loaded in the engine. Reload the engine and try again.");
  await client.rpc.call({ rpcID: outsideConfigRpc.id, method: "refresh", input: {}, location });
}
