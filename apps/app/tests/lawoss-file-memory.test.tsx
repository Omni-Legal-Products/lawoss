import { afterEach, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createHash } from "node:crypto";
import { FileMemoryIntegrationCard, MemoryProfileEditor, MemoryPreflight } from "../src/lawoss/domains/integrations/file-memory-integration-card";
import { checkMemoryProfile, loadMemoryProfile, previewMemoryProfile, saveMemoryProfile, MEMORY_PROFILE_PATH, parseWorkspaceMemoryProfileText } from "../src/lawoss/okf/workspace-memory-profile";
import type { ExtensionsViewProps } from "../src/react-app/domains/settings/pages/extensions-view";
import { memoryFixture } from "./lawoss-memory-fixture";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() { const f = await memoryFixture(); cleanups.push(f.cleanup); return f; }

test("native file API loads, edits and CAS-saves all mapping fields; preview grants no authority", async () => {
  const f = await fixture(), snapshot = await loadMemoryProfile(f.client, "matter");
  expect(snapshot.content).toBe(f.content); expect(snapshot.profile).toEqual(f.profile);
  const edited = { ...snapshot.profile, sources: snapshot.profile.sources.map(s => ({ ...s, path: s.id === "memory" ? "renamed.md" : s.path })) };
  const preview = previewMemoryProfile(edited);
  expect(parseWorkspaceMemoryProfileText(preview)).toEqual(edited);
  expect(await readFile(join(f.matter, MEMORY_PROFILE_PATH), "utf8")).toBe(f.content);
  expect((await f.client.getWorkspaceMemoryStatus("matter")).grants.folders).toEqual([]);
  const saved = await saveMemoryProfile(f.client, "matter", snapshot, edited);
  expect(await readFile(join(f.matter, MEMORY_PROFILE_PATH), "utf8")).toBe(saved.content);
  expect(saved.profile.sources[0]).toEqual({ ...snapshot.profile.sources[0], path: "renamed.md" });
  const status = await checkMemoryProfile(f.client, "matter", saved);
  expect(status.complete).toBe(false); expect(status.grants.folders).toEqual([]);
  expect(status.sources.find(s => s.id === "memory")?.status).toBe("missing");
  await expect(saveMemoryProfile(f.client, "matter", snapshot, snapshot.profile)).rejects.toThrow();
  expect(await readFile(join(f.matter, MEMORY_PROFILE_PATH), "utf8")).toBe(saved.content);
});
test("create-only CAS, malformed profile and changed disk snapshot fail closed", async () => {
  const f = await fixture(), path = join(f.matter, MEMORY_PROFILE_PATH);
  await writeFile(path, "{broken");
  await expect(loadMemoryProfile(f.client, "matter")).rejects.toThrow("nebude prepísaný");
  await rm(path);
  const absent = await loadMemoryProfile(f.client, "matter"); expect(absent.content).toBeNull();
  const profile = parseWorkspaceMemoryProfileText(f.content);
  const created = await saveMemoryProfile(f.client, "matter", absent, profile); expect(created.profile).toEqual(profile);
  await expect(saveMemoryProfile(f.client, "matter", absent, profile)).rejects.toThrow();
  await writeFile(path, f.content + "\n");
  await expect(checkMemoryProfile(f.client, "matter", created)).rejects.toThrow("na disku zmenil");
});
test("live server status separates grants, missing sources, read-only writes and unsaved readiness", async () => {
  const f = await fixture(), snapshot = await loadMemoryProfile(f.client, "matter");
  const incomplete = await checkMemoryProfile(f.client, "matter", snapshot);
  expect(incomplete.complete).toBe(false); expect(incomplete.grants.folders).toEqual([]);
  await f.client.setAuthorizedFolders("matter", [f.vault]);
  const ready = await checkMemoryProfile(f.client, "matter", snapshot);
  expect(ready.complete).toBe(true); expect(ready.grants.authority).toBe("runtime");
  expect(ready.profileHash).toBe(createHash("sha256").update(f.content).digest("hex"));
  expect(renderToStaticMarkup(<MemoryPreflight status={ready} dirty={false} />)).toContain("Pamäť je pripravená");
  const dirty = renderToStaticMarkup(<MemoryPreflight status={ready} dirty />);
  expect(dirty).not.toContain("Pamäť je pripravená"); expect(dirty).toContain("Neuložený návrh");
  await f.client.setAuthorizedFolders("matter", []);
  expect((await checkMemoryProfile(f.client, "matter", snapshot)).complete).toBe(false);
  f.config.readOnly = true;
  await expect(saveMemoryProfile(f.client, "matter", snapshot, snapshot.profile)).rejects.toThrow("iba čítanie");
  const html = renderToStaticMarkup(<MemoryRouter><MemoryProfileEditor client={f.client} workspaceId="matter" initial={snapshot} writable={false} onReload={() => {}} /></MemoryRouter>);
  expect(html).toContain('fieldset disabled=""'); expect(html).toContain("Náhľad JSON a zmien"); expect(html).toContain("Spravovať oprávnenia");
  expect(html).toContain('/workspace/matter/settings/permissions');
});
test("native card refuses disconnected, absent and remote workspaces", async () => {
  const f = await fixture();
  for (const props of [{ client: null, workspaceId: "matter", workspacePath: f.matter }, { client: f.client, workspaceId: null, workspacePath: "" }, { client: f.client, workspaceId: "matter", workspacePath: f.matter, remote: true }]) {
    const html = renderToStaticMarkup(<FileMemoryIntegrationCard {...props} workspaceName="Synthetic" />);
    expect(html).toContain("Vyberte pripojený lokálny workspace"); expect(html).not.toContain("Uložiť mapovanie");
  }
});
test("native Integrations entry renders file memory only in Connectors and preserves existing MCP content", async () => {
  const { ExtensionsView } = await import("../src/react-app/domains/settings/pages/extensions-view");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const props: ExtensionsViewProps = { busy: false, selectedWorkspaceRoot: "", isRemoteWorkspace: false, canEditPlugins: false, canUseGlobalScope: true, suggestedPlugins: [], mcpConnectedAppsCount: 0, mcpView: <p>Existing native MCP</p>, skillsView: <p>Native skills</p>, onRefresh: () => {}, extensions: {
    pluginScope: "project", setPluginScope: () => {}, refreshPlugins: () => {}, pluginConfigPath: () => null, pluginConfig: () => null, pluginList: () => [], pluginInput: () => "", setPluginInput: () => {}, pluginStatus: () => null, addPlugin: () => {}, removePlugin: () => {}, isPluginInstalledByName: () => false, activePluginGuide: () => null, setActivePluginGuide: () => {},
  }, fileMemoryView: <FileMemoryIntegrationCard client={null} workspaceId={null} workspacePath="" workspaceName="" /> };
  const render = (initialSection: "mcp" | "skills") => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ExtensionsView {...props} initialSection={initialSection} /></MemoryRouter></QueryClientProvider>);
  const html = render("mcp"); expect(html).toContain("Súborová pamäť spisu"); expect(html).toContain("Existing native MCP");
  expect(render("skills")).not.toContain("Súborová pamäť spisu");
});

test("oversized draft is rejected before native CAS writes any profile bytes", async () => {
  const f = await fixture(), snapshot = await loadMemoryProfile(f.client, "matter");
  const oversized = { ...snapshot.profile, sources: snapshot.profile.sources.map(source => ({ ...source, anchors: ["x".repeat(300_000)] })) };
  await expect(saveMemoryProfile(f.client, "matter", snapshot, oversized)).rejects.toThrow("byte limit");
  expect(await readFile(join(f.matter, MEMORY_PROFILE_PATH), "utf8")).toBe(f.content);
});
