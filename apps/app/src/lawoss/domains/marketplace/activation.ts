import type { MarketplaceEntry } from "./catalog";

type PluginInstaller = {
  installClaudePlugin: (workspaceId: string, payload: { url: string; ref: string }) => Promise<{ preview: { warnings: string[] } }>;
};

export async function activatePlugin(client: PluginInstaller, workspaceId: string, entry: MarketplaceEntry) {
  if (entry.install.action !== "plugin" || !entry.install.path || !/^[a-f0-9]{40}$/.test(entry.source.ref)) {
    throw new Error("Táto položka nemá podporovaný pripnutý balík.");
  }
  return client.installClaudePlugin(workspaceId, {
    url: `https://github.com/${entry.source.repository}/tree/${entry.source.ref}/${entry.install.path}`,
    ref: entry.source.ref,
  });
}
