import { describe, expect, test } from "bun:test";
import type { ImportedPlugin } from "../src/app/lib/extension-imports";
import type { ComposerPart, McpStatusMap } from "../src/app/types";
import { createPluginComposerMention, decodeComposerMentionValue, encodeComposerMentionValue, parsePluginComposerMention } from "../src/react-app/domains/session/surface/composer/mention-encoding";
import { buildComposerDraft } from "../src/react-app/domains/session/surface/composer/composer-draft";
import { buildPluginSelectionContext, loadPluginSelectionContext } from "../src/react-app/domains/session/surface/composer/plugin-selection";
import { getComposerQueuedDrafts, useComposerStateStore } from "../src/react-app/domains/session/surface/composer-state-store";

const connector = "github-12345678-plugin-global-github-abcdef";
const plugin: ImportedPlugin = {
  pluginId: "github-package", name: "github", displayName: "GitHub", scope: "global", sourceKind: "plugin",
  marketplaceId: null, description: "Source descriptions are not model instructions", updatedAt: null, importedAt: 1,
  files: [
    { configObjectId: "skill", objectType: "skill", title: "Internal skill title", path: ".opencode/skills/github-12345678-plugin/github-review/SKILL.md", updatedAt: null },
    { configObjectId: "connector", objectType: "mcp", title: "Internal connector title", path: `opencode.jsonc#mcp.${connector}`, updatedAt: null },
    { configObjectId: "agent", objectType: "agent", title: "Internal agent title", path: ".opencode/agents/github-12345678-plugin/reviewer.md", updatedAt: null },
    { configObjectId: "command", objectType: "command", title: "Internal command title", path: ".opencode/commands/github-12345678-plugin/review.md", updatedAt: null },
    { configObjectId: "source", objectType: "file", title: "Source only", path: "bundle/plugin.json", updatedAt: null },
  ],
};
const part: ComposerPart = { type: "plugin", pluginId: plugin.pluginId, label: "GitHub" };
function data(context: string) { return JSON.parse(context.slice(context.indexOf("\n") + 1)); }

describe("whole-plugin composer selection", () => {
  test("one plugin reference keeps its stable ID and readable label through encoding and draft restoration", () => {
    const value = createPluginComposerMention("package id/%", "Clerk & GitHub [tools] @home");
    const token = `@${encodeComposerMentionValue(value)}`;
    expect(decodeComposerMentionValue(token.slice(1))).toBe(value);
    expect(parsePluginComposerMention(value)).toEqual({ pluginId: "package id/%", label: "Clerk & GitHub [tools] @home" });
    const draft = buildComposerDraft(`Review this ${token} carefully`, [], {}, []);
    expect(draft.parts).toEqual([{ type: "text", text: "Review this " }, { type: "plugin", pluginId: "package id/%", label: "Clerk & GitHub [tools] @home" }, { type: "text", text: " carefully" }]);
    expect(draft.resolvedText).toBe('Review this [plugin "Clerk & GitHub [tools] @home"] carefully');
    expect(draft.modelContext).toBeUndefined();
    expect(draft.resolvedText).not.toContain("legalwork-plugin://");
  });

  test("invalid references cannot select a plugin", () => {
    expect(parsePluginComposerMention("legalwork-plugin://%zz?name=Invalid")).toBeNull();
    expect(parsePluginComposerMention("legalwork-plugin://?name=Missing")).toBeNull();
    expect(parsePluginComposerMention("https://plugin.example/id")).toBeNull();
  });

  test("plugin selection is sent as a prompt even when the draft starts with slash-command text", () => {
    const value = createPluginComposerMention(plugin.pluginId, "GitHub");
    expect(buildComposerDraft(`/review @${encodeComposerMentionValue(value)}`, [], {}, []).command).toBeUndefined();
    expect(buildComposerDraft("/review agreements", [], {}, []).command).toEqual({ name: "review", arguments: "agreements" });
  });

  test("mixed paste, file and skill references retain their behavior", () => {
    const value = createPluginComposerMention(plugin.pluginId, "GitHub");
    const draft = buildComposerDraft(`@notes.md [skill drafting] [pasted text 1] @${encodeComposerMentionValue(value)}`, [], { "notes.md": "file" }, [{ id: "paste", label: "1", text: "Example request", lines: 1 }]);
    expect(draft.parts.filter(part => part.type !== "text")).toEqual([
      { type: "file", path: "notes.md", label: "notes.md" }, { type: "skill", name: "drafting" },
      { type: "paste", id: "paste", label: "1", text: "Example request", lines: 1 }, part,
    ]);
    expect(draft.resolvedText).toContain("Example request");
    expect(draft.resolvedText).toContain('the "drafting" skill');
  });

  test("whole-plugin context uses exact installed identities without copying source instructions or credentials", () => {
    const config = { type: "remote", url: "https://private.example/mcp", enabled: true, headers: { Authorization: "Bearer sensitive-token" }, environment: { PRIVATE_VALUE: "private-env" } };
    const context = buildPluginSelectionContext([plugin.pluginId, plugin.pluginId], [plugin], [{ name: connector, config, source: "config.global" }], { [connector]: { status: "connected" } });
    expect(data(context)).toEqual([{ pluginId: plugin.pluginId, name: "GitHub", components: [
      { type: "skill", name: "github-review" }, { type: "connector", name: connector, state: "connected" },
      { type: "agent", name: "github-12345678-plugin/reviewer" }, { type: "command", name: "github-12345678-plugin/review" },
    ] }]);
    expect(context).toContain("do not load or execute every component");
    for (const value of ["sensitive-token", "private-env", "private.example", plugin.description, "Internal agent title", "bundle/plugin.json"]) expect(context).not.toContain(value);
    expect(config.enabled).toBe(true);
  });

  test("missing setup, disabled, sign-in and failure states stay distinct and do not enable connectors", () => {
    const cases: { config: Record<string, unknown>; statuses: McpStatusMap; state: string }[] = [
      { config: { type: "remote", enabled: false, headers: { Authorization: "Bearer ${TOKEN}" } }, statuses: {}, state: "needs_setup" },
      { config: { type: "remote", enabled: false }, statuses: { [connector]: { status: "connected" } }, state: "disabled" },
      { config: { type: "remote" }, statuses: { [connector]: { status: "needs_auth" } }, state: "needs_auth" },
      { config: { type: "remote" }, statuses: { [connector]: { status: "failed", error: "Secret transport error" } }, state: "failed" },
    ];
    for (const { config, statuses, state } of cases) {
      const context = buildPluginSelectionContext([plugin.pluginId], [plugin], [{ name: connector, config, source: "config.global" }], statuses);
      expect(data(context)[0].components[1].state).toBe(state);
      expect(context).not.toContain("Secret transport error");
      expect(config.enabled).not.toBe(true);
    }
    expect(data(buildPluginSelectionContext([plugin.pluginId], [plugin], [], {}))[0].components[1].state).toBe("unavailable");
  });

  test("removal, standalone wrappers and unsupported packages cannot silently become plugin requests", () => {
    expect(() => buildPluginSelectionContext([plugin.pluginId], [], [], {})).toThrow("no longer available");
    expect(() => buildPluginSelectionContext([plugin.pluginId], [{ ...plugin, sourceKind: "connector" }], [], {})).toThrow("no longer available");
    expect(() => buildPluginSelectionContext([plugin.pluginId], [{ ...plugin, files: [plugin.files[4]] }], [], {})).toThrow("no supported components");
  });

  test("fresh metadata is resolved for every send and skill-only plugins need no connector requests", async () => {
    let current = { ...plugin, files: plugin.files.slice(0, 1) };
    const requests: string[] = [];
    const client = {
      listCloudPlugins: async (workspaceId: string) => { requests.push(workspaceId); return { marketplaces: {}, plugins: { [plugin.pluginId]: current } }; },
      listMcp: async () => { throw new Error("Unused connector endpoint"); },
    };
    const readStatuses = async () => { throw new Error("Unused status endpoint"); };
    const first = await loadPluginSelectionContext({ parts: [part], client, workspaceId: "remote-workspace", readStatuses });
    current = { ...current, files: [{ ...current.files[0], path: ".opencode/skills/new-review/SKILL.md" }] };
    const updated = await loadPluginSelectionContext({ parts: [part], client, workspaceId: "remote-workspace", readStatuses });
    expect(first).toContain("github-review");
    expect(updated).toContain("new-review");
    expect(updated).not.toContain("github-review");
    expect(requests).toEqual(["remote-workspace", "remote-workspace"]);
  });

  test("ordinary messages do not fetch plugins or connection state", async () => {
    const unused = async () => { throw new Error("Must not fetch"); };
    expect(await loadPluginSelectionContext({ parts: [{ type: "text", text: "Hello" }], client: { listCloudPlugins: unused, listMcp: unused }, workspaceId: "project", readStatuses: unused })).toBe("");
  });

  test("queued editing preserves the plugin identity and chip metadata", () => {
    const session = "whole-plugin-queue-test";
    const value = createPluginComposerMention(plugin.pluginId, "GitHub");
    const text = `Use @${encodeComposerMentionValue(value)} to review this`;
    const store = useComposerStateStore.getState();
    store.setDraft(session, text);
    store.setMentions(session, { [value]: "plugin" });
    store.appendQueuedDraft(session, buildComposerDraft(text, [], { [value]: "plugin" }, []));
    const queued = getComposerQueuedDrafts(useComposerStateStore.getState(), session)[0];
    expect(queued.parts).toContainEqual(part);
    store.editQueuedDraft(session, queued.id);
    expect(useComposerStateStore.getState().sessions[session].mentions[value]).toBe("plugin");
    expect(useComposerStateStore.getState().sessions[session].draft).toBe(text);
    store.clearSession(session);
    store.clearQueuedDrafts(session);
  });
});
