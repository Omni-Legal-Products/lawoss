import { describe, expect, test } from "bun:test";
import { MARKETPLACE_CATALOG } from "../src/lawoss/domains/marketplace/catalog";
import { catalogPluginId, catalogPluginUrl, installCatalogEntry, nativeIntegrationRoute, refreshIntegrationState } from "../src/lawoss/domains/marketplace/native-actions";

const plugin = MARKETPLACE_CATALOG.find((entry) => entry.id === "orsr")!;
const okf = MARKETPLACE_CATALOG.find((entry) => entry.id === "okf")!;
function actions() {
  const calls: string[] = [];
  return { calls, workspaceId: "selected", canInstallPlugin: true, canInstallSkills: true,
    installPlugin: async (url: string) => { calls.push(url); return { ok: true, message: "installed" }; },
    installOkf: async () => { calls.push("okf"); return { ok: true, message: "skills installed" }; },
    refresh: async () => { calls.push("refresh"); },
  };
}
describe("native integrations catalog", () => {
  test("legacy routes keep selected workspace and native tab with no-workspace fallback", () => {
    expect(nativeIntegrationRoute("/marketplace", "a/b")).toBe("/workspace/a%2Fb/settings/extensions/plugins");
    expect(nativeIntegrationRoute("/konektory", "selected")).toBe("/workspace/selected/settings/extensions/mcp");
    expect(nativeIntegrationRoute("/marketplace", null)).toBe("/settings/extensions/plugins");
  });
  test("installation uses immutable catalog URL and native refresh", async () => {
    const context = actions();
    expect(await installCatalogEntry(plugin, context)).toEqual({ ok: true, message: "installed" });
    expect(context.calls).toEqual(["https://github.com/Omni-Legal-Products/lawoss-marketplace/tree/deff09cf87c6e81bfbeebadf675a67b698920be6/plugins/orsr", "refresh"]);
    expect(catalogPluginId(plugin)).toBe("github:Omni-Legal-Products/lawoss-marketplace#plugins/orsr");
  });
  test("readonly, missing workspace and non-workspace scopes cannot mutate", async () => {
    for (const context of [{ ...actions(), canInstallPlugin: false }, { ...actions(), workspaceId: "" }]) {
      await expect(installCatalogEntry(plugin, context)).rejects.toThrow();
      expect(context.calls).toEqual([]);
    }
    const context = actions();
    await expect(installCatalogEntry({ ...plugin, install: { ...plugin.install, scope: "global" } }, context)).rejects.toThrow();
    expect(context.calls).toEqual([]);
  });
  test("OKF uses skill permission and never plugin installer", async () => {
    const context = { ...actions(), canInstallPlugin: false };
    await expect(installCatalogEntry(okf, context)).resolves.toEqual({ ok: true, message: "skills installed" });
    expect(context.calls).toEqual(["okf", "refresh"]);
    await expect(installCatalogEntry(okf, { ...context, canInstallSkills: false })).rejects.toThrow();
  });
  test("native installer refusal stays failure and refreshes partial state", async () => {
    const context = actions();
    context.installPlugin = async () => ({ ok: false, message: "read only" });
    expect(await installCatalogEntry(plugin, context)).toEqual({ ok: false, message: "read only" });
    expect(context.calls).toEqual(["refresh"]);
  });
  test("partial write error is retained and all native sources refresh", async () => {
    const context = actions();
    context.installOkf = async () => { throw new Error("resource write failed"); };
    await expect(installCatalogEntry(okf, context)).rejects.toThrow("resource write failed");
    expect(context.calls).toEqual(["refresh"]);
    const calls: string[] = [];
    await expect(refreshIntegrationState([
      async () => { calls.push("plugins"); throw new Error("list unavailable"); },
      async () => { calls.push("skills"); }, async () => { calls.push("mcp"); },
    ])).rejects.toThrow("list unavailable");
    expect(calls).toEqual(["plugins", "skills", "mcp"]);
  });
  test("mutable and unsupported entries cannot install", async () => {
    expect(() => catalogPluginUrl({ ...plugin, source: { ...plugin.source, ref: "main" } })).toThrow();
    await expect(installCatalogEntry({ ...plugin, install: { scope: "workspace", action: "preview-only" } }, actions())).rejects.toThrow();
  });
});

describe("native imported plugin registry", () => {
  test("reads existing API per workspace and endpoint, including late responses", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { importedPluginsQuery } = await import("../src/lawoss/domains/marketplace/use-native-integrations");
    const cache = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
    const requests: string[] = [];
    let finishOld: () => void = () => {};
    const oldRequest = new Promise<void>((resolve) => { finishOld = resolve; });
    const client = { listCloudPlugins: async (workspace: string) => {
      requests.push(workspace);
      if (workspace === "old") await oldRequest;
      return { marketplaces: {}, plugins: { one: { pluginId: workspace, name: workspace, marketplaceId: null, description: null, updatedAt: null, files: [], importedAt: null } } };
    } };
    const first = cache.fetchQuery(importedPluginsQuery(client, "http://host-a", "old"));
    expect((await cache.fetchQuery(importedPluginsQuery(client, "http://host-a", "new")))[0].pluginId).toBe("new");
    finishOld(); await first;
    expect(cache.getQueryData(importedPluginsQuery(client, "http://host-a", "new").queryKey)?.[0].pluginId).toBe("new");
    expect(importedPluginsQuery(client, "http://host-a", "new").queryKey).not.toEqual(importedPluginsQuery(client, "http://host-b", "new").queryKey);
    expect(requests).toEqual(["old", "new"]);
    cache.clear();
  });
  test("a failed registry read rejects rather than returning an empty installation list", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { importedPluginsQuery } = await import("../src/lawoss/domains/marketplace/use-native-integrations");
    const cache = new QueryClient();
    await expect(cache.fetchQuery(importedPluginsQuery({ listCloudPlugins: async () => { throw new Error("registry unavailable"); } }, "http://host", "selected"))).rejects.toThrow("registry unavailable");
    cache.clear();
  });
  test("removal uses selected workspace, refreshes lists, preserves original failure", async () => {
    const { removeImportedPlugin } = await import("../src/lawoss/domains/marketplace/native-actions");
    const calls: unknown[] = [];
    const client = { removeCloudPlugin: async (workspace: string, plugin: string) => { calls.push([workspace, plugin]); throw new Error("removal denied"); } };
    await expect(removeImportedPlugin(client, "selected", "plugin-id", true, async () => { calls.push("refresh"); throw new Error("refresh failed"); })).rejects.toThrow("removal denied");
    expect(calls).toEqual([["selected", "plugin-id"], "refresh"]);
    calls.length = 0;
    await expect(removeImportedPlugin(client, "selected", "plugin-id", false, async () => {})).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
