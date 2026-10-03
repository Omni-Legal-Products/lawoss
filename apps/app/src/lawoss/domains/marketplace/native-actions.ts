import { t } from "@/i18n";
import type { MarketplaceEntry } from "./catalog";
import { workspaceSettingsRoute } from "../../../react-app/shell/workspace-routes";

export type InstallResult = { ok: boolean; message: string; messageKey?: string };
export type CatalogActions = {
  workspaceId: string;
  canInstallPlugin: boolean;
  canInstallSkills: boolean;
  installPlugin: (url: string) => Promise<InstallResult>;
  installOkf: () => Promise<InstallResult>;
  refresh: () => Promise<void>;
};

export function nativeIntegrationRoute(path: "/marketplace" | "/konektory", workspaceId: string | null) {
  const section = path === "/marketplace" ? "extensions/plugins" : "extensions/mcp";
  return workspaceId?.trim() ? workspaceSettingsRoute(workspaceId, section) : `/settings/${section}`;
}

export function catalogPluginUrl(entry: MarketplaceEntry) {
  if (entry.install.action !== "plugin" || !entry.install.path || !/^[a-f0-9]{40}$/.test(entry.source.ref)) {
    throw new Error(t("lawoss.integrations.catalog.unsupported_package"));
  }
  return `https://github.com/${entry.source.repository}/tree/${entry.source.ref}/${entry.install.path}`;
}

/** Same identity returned by the existing GitHub bundle importer; it does not assert a version. */
export function catalogPluginId(entry: MarketplaceEntry) {
  return `github:${entry.source.repository}#${entry.install.path}`;
}

export async function refreshIntegrationState(refreshers: Array<() => void | Promise<unknown>>) {
  const results = await Promise.allSettled(refreshers.map(async (refresh) => refresh()));
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

export async function installCatalogEntry(entry: MarketplaceEntry, actions: CatalogActions): Promise<InstallResult> {
  if (!actions.workspaceId || entry.install.scope !== "workspace") throw new Error(t("lawoss.integrations.catalog.select_workspace"));
  const allowed = entry.install.action === "okf" ? actions.canInstallSkills : actions.canInstallPlugin;
  if (!allowed) throw new Error(t("lawoss.integrations.catalog.install_denied"));
  if (entry.install.action !== "okf" && entry.install.action !== "plugin") throw new Error(t("lawoss.integrations.catalog.unsupported_install"));
  const url = entry.install.action === "plugin" ? catalogPluginUrl(entry) : null;
  return installWithRefresh(() => url ? actions.installPlugin(url) : actions.installOkf(), actions.refresh);
}

export async function installWithRefresh(install: () => Promise<InstallResult>, refresh: () => Promise<void>): Promise<InstallResult> {
  let result: InstallResult;
  try {
    result = await install();
  } catch (error) {
    // Installation can fail after writing some components. Refresh without hiding the original error.
    await refresh().catch(() => undefined);
    throw error;
  }
  try {
    await refresh();
  } catch (error) {
    if (!result.ok) return result;
    return { ok: false, message: t("lawoss.integrations.catalog.refresh_failed", { message: result.message, detail: error instanceof Error ? error.message : String(error) }) };
  }
  return result;
}

export async function removeImportedPlugin(
  client: { removeCloudPlugin: (workspaceId: string, pluginId: string) => Promise<unknown> },
  workspaceId: string,
  pluginId: string,
  canRemove: boolean,
  refresh: () => Promise<void>,
) {
  if (!workspaceId || !canRemove) throw new Error(t("lawoss.integrations.catalog.remove_denied"));
  try {
    await client.removeCloudPlugin(workspaceId, pluginId);
  } catch (error) {
    await refresh().catch(() => undefined);
    throw error;
  }
  await refresh();
}
