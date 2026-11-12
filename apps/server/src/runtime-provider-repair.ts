/** Validate native provider definitions without discarding a user's connection.
 * The retired LegalWork-owned free tier remains the only removable provider.
 * Legacy records are handled by the versioned upgrade, before normal runtime.
 */
import { ConfigProvider } from "@opencode/schema/config/provider";
import { Schema } from "effect";
import { GLOBAL_PROVIDERS_ID, readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";
import { canRestoreOllamaActivation, repairOllamaProvider } from "./lawoss/ollama-provider-repair.js";

/** Provider ids LegalWork once injected and has since retired. */
export const RETIRED_PROVIDER_IDS: ReadonlySet<string> = new Set(["eigenwelt-free"]);

export type ProviderRepairNotice = {
  providerId: string;
  /** Display name from the block, falling back to the id. */
  name: string;
  reason: "retired" | "invalid";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerDisplayName(id: string, block: unknown): string {
  const name = isRecord(block) && typeof block.name === "string" ? block.name.trim() : "";
  return name || id;
}

/** Validate native definitions and remove only the retired app-owned provider. */
export function repairRuntimeProviders(
  providers: Record<string, unknown>,
): { providers: Record<string, typeof ConfigProvider.Info.Type>; removed: ProviderRepairNotice[]; repaired: string[] } {
  const kept: Record<string, typeof ConfigProvider.Info.Type> = {};
  const removed: ProviderRepairNotice[] = [];
  const repaired: string[] = [];
  for (const [id, block] of Object.entries(providers)) {
    if (RETIRED_PROVIDER_IDS.has(id)) {
      removed.push({ providerId: id, name: providerDisplayName(id, block), reason: "retired" });
    } else {
      try { kept[id] = Schema.decodeUnknownSync(ConfigProvider.Info)(block, { onExcessProperty: "error" }); }
      catch { throw new Error(`Saved provider "${id}" has invalid native settings. Correct or restore it; LegalWork has not removed the connection.`); }
      const corrected = repairOllamaProvider(kept[id]);
      if (corrected !== kept[id]) {
        kept[id] = corrected;
        repaired.push(id);
      }
    }
  }
  return { providers: kept, removed, repaired };
}

const noticesByWorkspace = new Map<string, ProviderRepairNotice[]>();

/** Providers dropped from a workspace's stored config since this server started. */
export function providerRepairNotices(workspaceId: string): ProviderRepairNotice[] {
  return noticesByWorkspace.get(workspaceId) ?? [];
}

export function resetProviderRepairNoticesForTests(): void {
  noticesByWorkspace.clear();
}

/**
 * Drop retired providers and repair local Ollama before the engine config is built.
 * Global repairs also clear that provider's stale activation in inheriting workspaces.
 */
export async function repairWorkspaceRuntimeProviders(
  config: ServerConfig,
  workspaceId: string,
  inheritedRepairs: readonly string[] = [],
): Promise<ProviderRepairNotice[]> {
  const current = await readRuntimeOpencodeConfig(config, workspaceId);
  const { removed, repaired } = repairRuntimeProviders(current.providers ?? {});
  if (!removed.length && !repaired.length && !inheritedRepairs.length) return [];
  const canRestore = workspaceId !== GLOBAL_PROVIDERS_ID && await canRestoreOllamaActivation(config, workspaceId);
  await writeRuntimeOpencodeConfig(config, workspaceId, (latest) => {
    const result = repairRuntimeProviders(latest.providers ?? {});
    // A workspace's own definition wins over the shared provider, including its activation.
    const candidates = [...result.repaired, ...inheritedRepairs.filter(id => !Object.hasOwn(latest.providers ?? {}, id))];
    const restored = new Set(canRestore ? candidates.filter(id => !latest.ollamaChatRepairIDs?.includes(id)) : []);
    const activation = { ...latest.providerActivation };
    for (const id of restored) if (activation[id] === "deny") delete activation[id];
    return {
      ...latest,
      providers: result.providers,
      ...(latest.providerActivation ? { providerActivation: activation } : {}),
      ...(latest.policies ? { policies: latest.policies.filter(rule => !(rule.action === "provider.use" && rule.effect === "deny" && restored.has(rule.resource))) } : {}),
      ...(restored.size ? { ollamaChatRepairIDs: [...new Set([...latest.ollamaChatRepairIDs ?? [], ...restored])] } : {}),
    };
  });
  if (removed.length) noticesByWorkspace.set(workspaceId, [...providerRepairNotices(workspaceId), ...removed]);
  return removed;
}

/** Startup pass over every hosted workspace. Never throws. */
export async function repairAllWorkspaceRuntimeProviders(config: ServerConfig): Promise<void> {
  if (config.readOnly) return;
  let globalRepairs: string[] = [];
  try {
    globalRepairs = repairRuntimeProviders((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).providers ?? {}).repaired;
  } catch (error) {
    console.warn(`Provider repair failed for global providers: ${error instanceof Error ? error.message : String(error)}`);
  }
  let workspacesRepaired = true;
  for (const workspace of config.workspaces) {
    try {
      for (const notice of await repairWorkspaceRuntimeProviders(config, workspace.id, globalRepairs)) {
        console.warn(`Removed provider "${notice.providerId}" from workspace ${workspace.id} (${notice.reason}).`);
      }
    } catch (error) {
      workspacesRepaired = false;
      console.warn(
        `Provider repair failed for workspace ${workspace.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  // Keep the broken global package as the retry marker until every dependent row is repaired.
  if (globalRepairs.length && !workspacesRepaired) return;
  // LAWOSS: aj globálny riadok vlastných poskytovateľov (GLOBAL_PROVIDERS_ID).
  try {
    for (const notice of await repairWorkspaceRuntimeProviders(config, GLOBAL_PROVIDERS_ID)) {
      console.warn(`Removed provider "${notice.providerId}" from global providers (${notice.reason}).`);
    }
  } catch (error) {
    console.warn(`Provider repair failed for global providers: ${error instanceof Error ? error.message : String(error)}`);
  }
}
