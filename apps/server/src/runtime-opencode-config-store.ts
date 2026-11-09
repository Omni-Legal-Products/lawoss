import { GuidanceAckSchema, type GuidanceAck } from "./ai-governance-schema.js";
import { drainRuntimeDb, runtimeDbPath, runtimeDbResource, withRuntimeDb } from "./runtime-db-lifecycle.js";
import { sandboxSettingsSchema, sandboxSyncSchema, type SandboxSettings } from "./agent-sandbox/settings-schema.js";
import { dirname } from "node:path";
import type { ServerConfig } from "./types.js";
import { connectorConfigVariables } from "./connector-config.js";
import { ApiError } from "./errors.js";
import { withLawossToolDefaultRules } from "./lawoss/tool-permission-defaults.js";
import { appliedOrgPolicy } from "./org-policy.js";
import { z } from "zod";
import { openNativeConfigState } from "./native-config-state.js";
import { decodeNativeRuntimeConfigRecord, nativeRuntimeConfigRecord, runtimeEngineConfiguration, upgradeRuntimeConfigRecord,
  type NativeRuntimeConfiguration, type RuntimeConfigUpgradeNotice } from "./runtime-config-upgrade.js";

export { runtimeEngineConfiguration } from "./runtime-config-upgrade.js";

export type RuntimeOpencodeConfig = { -readonly [Key in keyof NativeRuntimeConfiguration]: NativeRuntimeConfiguration[Key] } & {
  /** Every persisted row is native V2. New native writes are stamped by the store. */
  configurationVersion?: 2;
  /** Informational read acknowledgment; never a permission or provider profile. */
  guidanceAck?: GuidanceAck;
  aiPreference?: {version: 1; preferredMode: "local" | "unspecified"; sourceHash: string};
  /** LAWOSS: the user's „AI hranice" choice (lawoss/ai-boundaries.ts); absent means the alpha default. */
  aiBoundaries?: {enforced: boolean} | {invalid: true};
  /** LAWOSS: „YOLO Mode" in the global tool-permission row (lawoss/yolo-mode.ts); absent or damaged means off. */
  lawossYolo?: {enabled: true};
  sandbox?: SandboxSettings;
  sandboxEdit?: string;
  sandboxSync?: { account: string; revision: number; dirty: boolean };
  sandboxNetworkMode?: "allow" | "block" | "approve";
  /** App-owned switches, independent of user-authored policy statements. */
  providerActivation?: Record<string, "allow" | "deny">;
  providerModelSelection?: Record<string, string[]>;
  /** Immutable app-private receipts prevent legacy grants replaying after revocation. */
  nativeSavedApprovalImportIDs?: string[];
  projectPermissionApprovals?: Array<{ id: string; action: string; resources: string[]; createdAt: number; updatedAt?: number }>;
  personalization?: PersonalizationSettings;
};

export const PERSONALITY_VALUES = [
  "default",
  "pragmatic",
  "professional",
  "friendly",
  "candid",
] as const;

export type Personality = (typeof PERSONALITY_VALUES)[number];

export type PersonalizationSettings = {
  customInstructions: string;
  personality: Personality;
};

export const DEFAULT_PERSONALIZATION_SETTINGS: PersonalizationSettings = {
  customInstructions: "",
  personality: "pragmatic",
};

export const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 12_000;


type RuntimeOpencodeDb = Awaited<ReturnType<typeof openNativeConfigState>>;

export type RuntimeConfigUpgradeBackup = { sourceVersion: number; configJson: string; noticesJson: string; createdAt: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPersonality(value: unknown): value is Personality {
  return typeof value === "string" && PERSONALITY_VALUES.some((item) => item === value);
}

/** Settings saved while local memories existed also carry localMemoriesEnabled and allowToolAssistedMemory; they are dropped here. */
export function normalizePersonalizationSettings(value: unknown): PersonalizationSettings {
  if (!isRecord(value)) return { ...DEFAULT_PERSONALIZATION_SETTINGS };
  return {
    customInstructions:
      typeof value.customInstructions === "string"
        ? value.customInstructions.slice(0, MAX_CUSTOM_INSTRUCTIONS_LENGTH)
        : DEFAULT_PERSONALIZATION_SETTINGS.customInstructions,
    personality: isPersonality(value.personality)
      ? value.personality
      : DEFAULT_PERSONALIZATION_SETTINGS.personality,
  };
}

function normalizeRuntimeOpencodeConfig(value: unknown): RuntimeOpencodeConfig {
  const decoded = decodeNativeRuntimeConfigRecord(value);
  const application = decoded.application;
  const providerActivation: Record<string, "allow" | "deny"> = {};
  if (application.providerActivation !== undefined) {
    if (!isRecord(application.providerActivation)) throw new Error("Invalid saved provider activation controls.");
    for (const [id, effect] of Object.entries(application.providerActivation)) {
      if (effect !== "allow" && effect !== "deny") throw new Error("Invalid saved provider activation effect.");
      providerActivation[id] = effect;
    }
  }
  const personalization = isRecord(application.personalization)
    ? normalizePersonalizationSettings(application.personalization)
    : undefined;
  const nativeSavedApprovalImportIDs = application.nativeSavedApprovalImportIDs === undefined ? undefined
    : z.array(z.string().min(1)).parse(application.nativeSavedApprovalImportIDs);
  const projectPermissionApprovals = application.projectPermissionApprovals === undefined ? undefined
    : z.array(z.object({ id: z.string(), action: z.string(), resources: z.array(z.string()), createdAt: z.number().finite(), updatedAt: z.number().finite().optional() }).strict()).parse(application.projectPermissionApprovals);
  const guidanceAck = GuidanceAckSchema.safeParse(application.guidanceAck);
  const preferenceSource = application.aiPreference;
  const preference: RuntimeOpencodeConfig["aiPreference"] = isRecord(preferenceSource) && preferenceSource.version === 1
    && (preferenceSource.preferredMode === "local" || preferenceSource.preferredMode === "unspecified")
    && typeof preferenceSource.sourceHash === "string" && /^[a-f0-9]{64}$/.test(preferenceSource.sourceHash)
    ? {version: 1 as const, preferredMode: preferenceSource.preferredMode, sourceHash: preferenceSource.sourceHash} : undefined;
  const boundaries = application.aiBoundaries, yolo = application.lawossYolo;
  return {
    ...decoded.configuration,
    configurationVersion: 2,
    // LAWOSS app-owned fields (lawoss/runtime-config-keys.ts).
    ...(guidanceAck.success ? {guidanceAck: guidanceAck.data} : {}),
    ...(preference ? {aiPreference: preference} : {}),
    // A damaged value stays visible as invalid (treated as enforced), never silently dropped to the default.
    ...(boundaries === undefined ? {} : isRecord(boundaries) && typeof boundaries.enforced === "boolean" && Object.keys(boundaries).length === 1
      ? {aiBoundaries: {enforced: boundaries.enforced}} : {aiBoundaries: {invalid: true as const}}),
    ...(isRecord(yolo) && yolo.enabled === true ? {lawossYolo: {enabled: true as const}} : {}),
    ...(typeof application.sandboxEdit === "string" ? { sandboxEdit: application.sandboxEdit } : {}),
    ...(application.sandbox !== undefined ? { sandbox: sandboxSettingsSchema.parse(application.sandbox) } : {}),
    ...(application.sandboxSync !== undefined ? { sandboxSync: sandboxSyncSchema.parse(application.sandboxSync) } : {}),
    ...(application.sandboxNetworkMode !== undefined ? { sandboxNetworkMode:
      application.sandboxNetworkMode === "allow" || application.sandboxNetworkMode === "approve" ? application.sandboxNetworkMode : "block" } : {}),
    ...(Object.keys(providerActivation).length ? { providerActivation } : {}),
    ...(application.providerModelSelection === undefined ? {} : { providerModelSelection: z.record(z.string(), z.array(z.string())).parse(application.providerModelSelection) }),
    ...(personalization ? { personalization } : {}),
    ...(projectPermissionApprovals ? { projectPermissionApprovals } : {}),
    ...(nativeSavedApprovalImportIDs ? { nativeSavedApprovalImportIDs } : {}),
  };
}

// LAWOSS: one path owner pins the runtime DB identity for a server's lifetime (runtime-db-lifecycle.ts).
/** Directory holding runtime state (the SQLite DB and derived files). */
export function runtimeStorageDir(config: Pick<ServerConfig, "configPath">): string {
  return dirname(runtimeDbPath(config));
}

export type RuntimeOpencodeConfigWriteListener = (config: ServerConfig, workspaceId: string, change?: { permissionsChanged: boolean }) => void;

const writeListeners = new Set<RuntimeOpencodeConfigWriteListener>();

/**
 * Observe runtime config writes. Used to keep derived state (e.g. the
 * engine-visible runtime config file) in sync with the DB. Returns an
 * unsubscribe function. Every registered listener runs synchronously even if
 * another throws, so revocation guards cannot miss an already committed edit.
 * The write rejects with the first listener failure after notifying the rest.
 */
export function onRuntimeOpencodeConfigWrite(listener: RuntimeOpencodeConfigWriteListener): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

function notifyRuntimeConfigWrite(config: ServerConfig, workspaceId: string, permissionsChanged: boolean) {
  const errors: unknown[] = [];
  for (const listener of [...writeListeners]) {
    try { listener(config, workspaceId, { permissionsChanged }); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw errors[0];
}

// LAWOSS: the shared runtime-DB owner closes this handle only after the last listener stops
// and releases it at once on Windows (runtime-db-lifecycle.ts).
const resourceKey = Symbol("runtime-opencode-config-store");

/** Release a stopped server's config connection before removing its storage. */
export async function closeRuntimeOpencodeConfig(config: ServerConfig, path = runtimeDbPath(config)): Promise<void> {
  await drainRuntimeDb(config, path);
}

async function runtimeDb(config: ServerConfig, importLegacy = false): Promise<RuntimeOpencodeDb> {
  // The first opener decides the legacy import; it is the startup bootstrap below.
  return runtimeDbResource(config, resourceKey, path => openNativeConfigState(path, importLegacy ? (workspaceId, source) => {
    const imported = upgradeRuntimeConfigRecord(JSON.parse(source), { scope: [GLOBAL_TOOL_PERMISSIONS_ID, GLOBAL_MCP_ID, GLOBAL_PERSONALIZATION_ID, GLOBAL_PROVIDERS_ID].includes(workspaceId) ? "host" : "workspace" });
    return { configJson: JSON.stringify(normalizeRuntimeOpencodeConfig(nativeRuntimeConfigRecord(imported))), sourceVersion: imported.sourceVersion, noticesJson: JSON.stringify(imported.notices) };
  } : undefined));
}

/** Explicit startup-only boundary. Completed stores never consult retired
 * sources; normal reads and writes reject an unimported legacy profile. */
export async function bootstrapRuntimeOpencodeConfig(config: ServerConfig): Promise<void> {
  await withRuntimeDb(config, async () => { await runtimeDb(config, true); });
}

/** Startup evidence for app-owned stores whose data lives outside runtime.sqlite.
 * A completed component must never interpret its missing files as first use. */
export async function beginNativeConfigComponent(config: ServerConfig, id: string): Promise<"new" | "pending" | "complete"> {
  return withRuntimeDb(config, async () => (await runtimeDb(config)).beginComponent(id));
}
export async function completeNativeConfigComponent(config: ServerConfig, id: string): Promise<void> {
  await withRuntimeDb(config, async () => { (await runtimeDb(config)).completeComponent(id); });
}

/** The Tool Permissions settings screen supplies host defaults in this reserved
 * row. Explicit project rules and remembered chat approvals stay project scoped.
 * This id cannot collide with a real workspace (those are `ws_<hash>`). */
export const GLOBAL_TOOL_PERMISSIONS_ID = "__global_tool_permissions__";

/** Host-wide personalisation shared by every workspace served on this device. */
export const GLOBAL_PERSONALIZATION_ID = "__global_personalization__";

/**
 * Connectors (MCP servers) shared by every workspace this server hosts. On
 * desktop a connected app is meant to be available everywhere, and the
 * engine's OAuth tokens for it are already global (keyed by server name), so
 * the configuration lives in one row too: the runtime config file the engine
 * reads on every instance build is derived from this row plus the
 * workspace's own row, and the same map is hot-added into running instances.
 */
export const GLOBAL_MCP_ID = "__global_mcp__";

/** The shared connector map, keyed by server name. */
export async function readGlobalMcpMap(config: ServerConfig): Promise<Record<string, Record<string, unknown>>> {
  return runtimeMcpMap(await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID));
}

/**
 * LAWOSS: vlastní poskytovatelia (Ollama, LM Studio, OpenAI-compatible) pre každý priečinok,
 * ako konektory v GLOBAL_MCP_ID. Prihlásenia sú v engine globálne;
 * bez tohto riadku by sa vlastný poskytovateľ stratil pri prechode na iný priečinok.
 */
export const GLOBAL_PROVIDERS_ID = "__global_providers__";

export async function readGlobalProviderMap(config: ServerConfig): Promise<NonNullable<NativeRuntimeConfiguration["providers"]>> {
  return { ...(await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).providers };
}

export async function readGlobalPersonalizationSettings(
  config: ServerConfig,
): Promise<PersonalizationSettings> {
  const globalConfig = await readRuntimeOpencodeConfig(config, GLOBAL_PERSONALIZATION_ID);
  return normalizePersonalizationSettings(globalConfig.personalization);
}

/** Read native global tool rules (never includes a project folder grant). */
export async function readGlobalToolPermissions(config: ServerConfig): Promise<NonNullable<NativeRuntimeConfiguration["permissions"]>> {
  const globalConfig = await readRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID);
  const own = (globalConfig.permissions ?? []).filter(rule => rule.action !== "external_directory");
  // LAWOSS: nenastavené edit/shell sa pýtajú, ak o nich nerozhoduje firma (lawoss/tool-permission-defaults.ts).
  return withLawossToolDefaultRules(own, Object.keys((await appliedOrgPolicy(config, "tools.permissions"))?.value ?? {}));
}

/**
 * Native rule order is retained. A project's own rules follow the host defaults;
 * firm enforcement remains native policy with its separate authority.
 */
export function applyGlobalToolPermissions(
  runtimeConfig: RuntimeOpencodeConfig,
  globalPermission: NonNullable<NativeRuntimeConfiguration["permissions"]>,
): RuntimeOpencodeConfig {
  return { ...runtimeConfig, permissions: [...globalPermission, ...runtimeConfig.permissions ?? []] };
}

export function runtimePluginList(config: RuntimeOpencodeConfig): NonNullable<NativeRuntimeConfiguration["plugins"]> {
  return config.plugins ?? [];
}

export function runtimeDisabledProviderList(config: RuntimeOpencodeConfig): string[] {
  const effects = new Map<string, string>();
  for (const rule of config.policies ?? []) if (rule.action === "provider.use" && !/[?*]/.test(rule.resource)) effects.set(rule.resource, rule.effect);
  return [...effects].flatMap(([id, effect]) => effect === "deny" ? [id] : []);
}

export function runtimeMcpMap(config: RuntimeOpencodeConfig): Record<string, Record<string, unknown>> {
  return Object.fromEntries(Object.entries(config.mcp?.servers ?? {}).map(([name, entry]): [string, Record<string, unknown>] => [name,
    connectorConfigVariables(entry).length || "url" in entry && entry.url === "https://configure-before-connecting.invalid/mcp" ? { ...entry, disabled: true } : { ...entry },
  ]));
}

export function runtimeAgentMap(config: RuntimeOpencodeConfig): NonNullable<NativeRuntimeConfiguration["agents"]> {
  return config.agents ?? {};
}

export function runtimeExternalDirectory(config: RuntimeOpencodeConfig): NonNullable<NativeRuntimeConfiguration["permissions"]> {
  return (config.permissions ?? []).filter(rule => rule.action === "external_directory");
}

function savedConfigError(options: { settingsScope?: "application" | "session" } = {}, cause?: unknown) {
  const reason = cause instanceof ApiError && isRecord(cause.details) && typeof cause.details.reason === "string" ? cause.details.reason : undefined;
  return new ApiError(409, "execution_settings_invalid", "Saved native settings could not be loaded safely. LegalWork has stopped this operation to avoid resetting your permissions. Restore or repair the original app profile before retrying.", { settingsScope: options.settingsScope ?? "application", ...(reason ? { reason } : {}) });
}

function permissionFingerprint(config: RuntimeOpencodeConfig) {
  return JSON.stringify({ permissions: config.permissions,
    agents: Object.fromEntries(Object.entries(config.agents ?? {}).map(([id, agent]) => [id, agent.permissions])),
    approvals: [...new Set((config.projectPermissionApprovals ?? []).map(approval => JSON.stringify([approval.action, [...approval.resources].sort()])))].sort(),
  });
}

function readStoredConfig(db: RuntimeOpencodeDb, workspaceId: string): RuntimeOpencodeConfig {
  const row = db.get(workspaceId);
  if (!row) return normalizeRuntimeOpencodeConfig({});
  const parsed: unknown = JSON.parse(row.configJson);
  if (!isRecord(parsed) || parsed.configurationVersion !== 2) throw new Error("Current settings must declare native configuration version 2.");
  return normalizeRuntimeOpencodeConfig(parsed);
}

/** Originals never leave this private store; no client route exposes them. */
export async function readRuntimeConfigUpgradeBackups(config: ServerConfig, workspaceId: string) {
  return withRuntimeDb(config, async () => (await runtimeDb(config)).backups(workspaceId));
}

export async function runtimeConfigUpgradeNotices(config: ServerConfig, workspaceId: string): Promise<RuntimeConfigUpgradeNotice[]> {
  const backups = await withRuntimeDb(config, async () => (await runtimeDb(config)).backups(workspaceId));
  return backups.flatMap(backup => {
    const value: unknown = JSON.parse(backup.noticesJson);
    if (!Array.isArray(value)) throw new Error("Invalid saved configuration upgrade notices.");
    return value.flatMap((item: unknown): RuntimeConfigUpgradeNotice[] => {
      if (!isRecord(item) || !Array.isArray(item.fields) || !item.fields.every(field => typeof field === "string")) throw new Error("Invalid saved configuration upgrade notice.");
      if (item.code === "legacy_agent_generation_requires_native_support" && typeof item.agentId === "string") return [{ code: item.code, agentId: item.agentId, fields: item.fields }];
      if (item.code === "legacy_workspace_tool_permissions_inactive") return [{ code: item.code, fields: item.fields }];
      if (item.code === "retired_managed_browser_replaced") return [{ code: item.code, fields: item.fields }];
      if (item.code === "sandbox_settings_repaired") return [{ code: item.code, fields: item.fields }];
      if (item.code === "ai_boundaries_repaired") return [{ code: item.code, fields: item.fields }];
      throw new Error("Invalid saved configuration upgrade notice.");
    });
  });
}

export async function readRuntimeOpencodeConfig(config: ServerConfig, workspaceId: string, options: { failOnInvalid?: boolean; settingsScope?: "application" | "session" } = {}): Promise<RuntimeOpencodeConfig> {
  return withRuntimeDb(config, async () => {
  const db = await runtimeDb(config);
  try {
    return readStoredConfig(db, workspaceId);
  } catch (error) {
    // A failed migration can contain restrictions. Never replace it with an
    // empty configuration, even when a display caller omitted failOnInvalid.
    throw savedConfigError(options, error);
  }
  });
}

/** LAWOSS: the stored JSON text of one row (null when absent), for fail-closed readers. */
export async function readRuntimeOpencodeConfigText(config: ServerConfig, workspaceId: string): Promise<string | null> {
  return withRuntimeDb(config, async () => (await runtimeDb(config)).get(workspaceId)?.configJson ?? null);
}

export async function writeRuntimeOpencodeConfig(
  config: ServerConfig,
  workspaceId: string,
  updater: (current: RuntimeOpencodeConfig) => RuntimeOpencodeConfig,
): Promise<RuntimeOpencodeConfig> {
  return withRuntimeDb(config, async () => {
  const db = await runtimeDb(config);
  // Every app client shares this server. Keep the synchronous SQLite read,
  // updater and replacement together: awaiting a second read here let parallel
  // connector/provider edits overwrite one another with the same old row.
  let current: RuntimeOpencodeConfig;
  try { current = readStoredConfig(db, workspaceId); }
  catch (error) { throw savedConfigError({}, error); }
  // Snapshot before the updater, which may mutate current in place. Keep key
  // order: ordered permission rules can change meaning when reordered.
  const previous = JSON.stringify(current);
  const previousPermissions = permissionFingerprint(current);
  // Preserve import history even when a settings editor replaces all ordinary
  // project settings. Revoking a grant must not revive its old engine record.
  const importIDs = [...current.nativeSavedApprovalImportIDs ?? []];
  const updated = updater(current);
  const next = normalizeRuntimeOpencodeConfig({ ...updated,
    ...(importIDs.length || updated.nativeSavedApprovalImportIDs?.length ? { nativeSavedApprovalImportIDs: [...new Set([...importIDs, ...updated.nativeSavedApprovalImportIDs ?? []])] } : {}),
  });
  const configJson = JSON.stringify(next);
  if (configJson === previous && db.has(workspaceId)) return next;
  const now = Date.now();
  db.upsert({ workspaceId, configJson, updatedAt: now });
  const permissionsChanged = previousPermissions !== permissionFingerprint(next);
  notifyRuntimeConfigWrite(config, workspaceId, permissionsChanged);
  return next;
  });
}

type SandboxRuntimeMetadata = Pick<RuntimeOpencodeConfig, "sandbox" | "sandboxEdit" | "sandboxSync">;

/** An explicit, complete sandbox-settings update can repair its reserved row.
 * The invalid original is backed up in the same transaction as replacement.
 * This API cannot select an ordinary project or carry engine permission keys. */
export async function writeSandboxRuntimeConfig(config: ServerConfig,
  target: { kind: "default" } | { kind: "session"; workspaceId: string; sessionId: string },
  updater: (current: SandboxRuntimeMetadata) => SandboxRuntimeMetadata,
): Promise<void> {
  const workspaceId = target.kind === "default" ? "__sandbox_default__" : `__sandbox_session__${JSON.stringify([target.workspaceId, target.sessionId])}`;
  return withRuntimeDb(config, async () => {
  const db = await runtimeDb(config);
  const source = db.source(workspaceId);
  const update = (current: RuntimeOpencodeConfig) => {
    const next = updater({ sandbox: current.sandbox, sandboxEdit: current.sandboxEdit, sandboxSync: current.sandboxSync });
    if (Object.keys(next).some(key => !["sandbox", "sandboxEdit", "sandboxSync"].includes(key))) throw new Error("A sandbox-settings update cannot replace engine configuration.");
    return normalizeRuntimeOpencodeConfig({ ...current, ...next });
  };
  try { readStoredConfig(db, workspaceId); }
  catch {
    if (!source) throw savedConfigError();
    const next = update(normalizeRuntimeOpencodeConfig({}));
    db.upgrade({ workspaceId, sourceJson: source.configJson, sourceVersion: -1, configJson: JSON.stringify(next), noticesJson: JSON.stringify([{ code: "sandbox_settings_repaired", fields: ["sandbox"] }]), updatedAt: Date.now() });
    notifyRuntimeConfigWrite(config, workspaceId, true);
    return;
  }
  await writeRuntimeOpencodeConfig(config, workspaceId, update);
  });
}

/** LAWOSS: an explicitly confirmed update of one app-owned row that also repairs it when the stored
 * row can no longer be read. The unreadable original is backed up in the same transaction as its
 * replacement, exactly like the reserved sandbox row above; a readable row is only updated. */
export async function repairApplicationRuntimeConfig(config: ServerConfig, workspaceId: string,
  updater: (current: RuntimeOpencodeConfig) => RuntimeOpencodeConfig, notice: RuntimeConfigUpgradeNotice): Promise<void> {
  return withRuntimeDb(config, async () => {
    const db = await runtimeDb(config);
    const source = db.source(workspaceId);
    try { readStoredConfig(db, workspaceId); }
    catch {
      if (!source) throw savedConfigError();
      const next = normalizeRuntimeOpencodeConfig(updater(normalizeRuntimeOpencodeConfig({})));
      db.upgrade({ workspaceId, sourceJson: source.configJson, sourceVersion: -1, configJson: JSON.stringify(next), noticesJson: JSON.stringify([notice]), updatedAt: Date.now() });
      notifyRuntimeConfigWrite(config, workspaceId, true);
      return;
    }
    await writeRuntimeOpencodeConfig(config, workspaceId, updater);
  });
}

/**
 * Merge a provider patch into the current runtime provider map. A `null` value
 * in the patch removes that provider — patch payloads can't carry `undefined`
 * over JSON, so callers signal deletion with `null`. This is what lets a client
 * fully disconnect a custom/runtime provider (not just drop its credential).
 */
export function mergeRuntimeProviderPatch(
  current: Record<string, unknown> | undefined,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...(isRecord(current) ? current : {}),
    ...update,
  };
  for (const [key, value] of Object.entries(update)) {
    if (value === null) delete merged[key];
  }
  return merged;
}

export function mergeOpencodeConfigs(
  persisted: Record<string, unknown>,
  runtime: RuntimeOpencodeConfig,
): Record<string, unknown> {
  const native = runtimeEngineConfiguration(persisted);
  return {
    ...native,
    plugins: [
      ...native.plugins ?? [],
      ...runtimePluginList(runtime),
    ],
    policies: [...native.policies ?? [], ...runtime.policies ?? []],
    mcp: {
      ...native.mcp, ...runtime.mcp,
      servers: { ...native.mcp?.servers, ...runtime.mcp?.servers },
    },
    permissions: [...native.permissions ?? [], ...runtime.permissions ?? []],
    ...(runtime.providers ? { providers: { ...native.providers, ...runtime.providers } } : {}),
    ...(runtime.agents ? { agents: { ...native.agents, ...runtime.agents } } : {}),
    ...(runtime.default_agent ? { default_agent: runtime.default_agent } : {}),
  };
}
