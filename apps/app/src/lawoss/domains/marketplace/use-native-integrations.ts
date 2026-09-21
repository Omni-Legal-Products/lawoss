import { queryOptions, useQuery } from "@tanstack/react-query";
import type { LegalworkServerClient } from "../../../app/lib/legalwork-server";
import { refreshIntegrationState, removeImportedPlugin, type InstallResult } from "./native-actions";

export function importedPluginsQuery(client: Pick<LegalworkServerClient, "listCloudPlugins"> | null, endpoint: string, workspaceId: string | null) {
  return queryOptions({
    queryKey: ["workspace-imported-plugins", endpoint, workspaceId],
    queryFn: async () => {
      if (!client || !workspaceId) throw new Error("Vyberte dostupný pracovný priečinok.");
      const result = await client.listCloudPlugins(workspaceId);
      return Object.values(result.plugins);
    },
    retry: false,
  });
}

/** A read of the native import registry, scoped by endpoint and workspace, not a second install registry. */
export function useNativeIntegrations(options: {
  client: LegalworkServerClient | null;
  endpoint: string;
  workspaceId: string | null;
  enabled: boolean;
  canRemove: boolean;
  canInstallSkills: boolean;
  refreshSkills: () => void | Promise<unknown>;
  refreshPlugins: () => void | Promise<unknown>;
  refreshMcp: () => void | Promise<unknown>;
}) {
  const { client, workspaceId } = options;
  const imports = useQuery({
    ...importedPluginsQuery(client, options.endpoint, workspaceId),
    enabled: options.enabled && Boolean(client && workspaceId),
  });
  const refresh = async () => {
    await refreshIntegrationState([
      () => imports.refetch({ throwOnError: true }),
      options.refreshSkills, options.refreshPlugins, options.refreshMcp,
    ]);
  };
  const installOkf = async (): Promise<InstallResult> => {
    if (!client || !workspaceId) throw new Error("Vyberte dostupný pracovný priečinok.");
    if (!options.canInstallSkills) throw new Error("V tomto priečinku nemáte oprávnenie na inštaláciu.");
    return installNativeOkfPack(client, workspaceId);
  };
  const removePlugin = async (pluginId: string) => {
    if (!client || !workspaceId) throw new Error("Vyberte dostupný pracovný priečinok.");
    await removeImportedPlugin(client, workspaceId, pluginId, options.canRemove, refresh);
  };
  return { plugins: imports.data ?? [], loading: imports.isPending, error: imports.error, refresh, installOkf, removePlugin };
}

/** Shared native install action; each resource follows its skill in the captured workspace. */
export async function installNativeOkfPack(client: Pick<LegalworkServerClient, "upsertSkill" | "upsertSkillResource">, workspaceId: string): Promise<InstallResult> {
  const bundle = await import("../../okf/skill-bundle");
  for (const skill of [
    { name: bundle.NOVY_SPIS_SKILL_NAME, body: bundle.skillBody(), resource: bundle.OKF_CLI_RESOURCE_NAME, content: bundle.okfCliSource() },
    { name: bundle.OKF_PAMAT_SKILL_NAME, body: bundle.pamatSkillBody(), resource: bundle.OKF_MEMORY_CLI_RESOURCE_NAME, content: bundle.okfMemoryCliSource() },
    { name: bundle.USPORIADAJ_SPIS_SKILL_NAME, body: bundle.usporiadajSpisSkillBody(), resource: bundle.OKF_CLI_RESOURCE_NAME, content: bundle.okfCliSource() },
  ]) {
    await client.upsertSkill(workspaceId, { name: skill.name, ...skill.body });
    await client.upsertSkillResource(workspaceId, skill.name, { name: skill.resource, content: skill.content });
  }
  return { ok: true, message: "Skilly /novy-spis, /okf-pamat a /usporiadaj-spis sú uložené v tomto pracovnom priečinku." };
}
