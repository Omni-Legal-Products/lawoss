import { wikiPanelTab } from "../src/react-app/domains/wiki/wiki-tabs";
import { expect, test } from "bun:test";
import { WikiSuggestionSchema, suggestionIdFromFile, wikiSuggestionFile } from "@legalwork/types/wiki-suggestions";
import { suggestionLocation, suggestionPagePath, suggestionOutcome, suggestionTab } from "../src/react-app/domains/wiki/wiki-suggestion-model";
import { createPanelTabStore, usePanelTabStore } from "../src/react-app/domains/session/panel/panel-tab-store";

const id = "c9f74905-3cab-400c-94c9-3d5a9e22736f";
const draft = WikiSuggestionSchema.parse({ id, workspaceId: "originating-project", sessionId: "chat", status: "pending", title: "Knowledge", content: "# Knowledge", destination: { wikiId: "wiki", path: "Knowledge.md", baseRevision: null }, createdAt: 1, updatedAt: 1, revision: "r1", filePath: wikiSuggestionFile(id) });

test("suggestion results open a recoverable Markdown tab tied to the originating project", () => {
  const outcome = suggestionOutcome(JSON.stringify({ suggestion: draft, staged: true, published: false }));
  expect(outcome).toEqual(draft);
  const tab = suggestionTab(draft);
  const store = usePanelTabStore;
  store.getState().openTab("workspace:review", tab, undefined, undefined, { besideChat: true });
  const restored = store.getState().readLayout(JSON.parse(JSON.stringify(store.getState().sessions["workspace:review"])));
  expect(restored?.tabs[0]).toEqual(tab);
  expect(tab.wikiSuggestion?.workspaceId).toBe("originating-project");
  expect(suggestionIdFromFile(`/project/${tab.value}`)).toBe(id);
});
test("normal wiki writes and malformed tool outputs are not proposal cards", () => {
  for (const value of ["{", { ok: true, path: "Knowledge.md" }, { suggestion: { id, title: "bad" } }]) expect(suggestionOutcome(value)).toBeNull();
  for (const path of ["draft.md", ".legalwork/tmp/wiki-suggestions/../draft.md", "Knowledge/draft.md"]) expect(suggestionIdFromFile(path)).toBeNull();
});


test("Save replaces the draft in its own pane and position without opening another tab", () => {
  const store = createPanelTabStore();
  const state = () => store.getState();
  const scope = "workspace:project";
  const proposal = suggestionTab(draft);
  state().openTab(scope, { id: "chat", type: "chat", sessionId: "chat", label: "Chat" });
  state().openTab(scope, proposal, undefined, undefined, { besideChat: true });
  const before = state().sessions[scope];
  const pane = before.panes.find(pane => pane.tabIds.includes(proposal.id))!;
  const saved = wikiPanelTab("http://local", "wiki", { kind: "page", path: "Knowledge.md" }, "Knowledge");
  state().replaceTab(proposal.id, saved);
  const after = state().sessions[scope];
  expect(after.tabs).toHaveLength(before.tabs.length);
  expect(after.tabs.map(tab => tab.id)).toEqual(before.tabs.map(tab => tab.id === proposal.id ? saved.id : tab.id));
  expect(after.panes.find(entry => entry.id === pane.id)).toMatchObject({ tabIds: [saved.id], activeTabId: saved.id });
  expect(after.tree).toEqual(before.tree);
  expect(after.focusedPaneId).toBe(before.focusedPaneId);
  expect(state().readLayout(JSON.parse(JSON.stringify(after)))?.tabs).toContainEqual(saved);
});

test("destination names stay relative and Markdown without exposing a raw path editor", () => {
  expect(suggestionLocation("Topics/Privacy/Prompt caching.md")).toEqual({ folder: "Topics/Privacy", name: "Prompt caching" });
  expect(suggestionPagePath("Topics/Privacy", "Prompt caching")).toBe("Topics/Privacy/Prompt caching.md");
  expect(suggestionPagePath("", "Finding.md")).toBe("Finding.md");
  for (const name of ["../Escape", "Bad/Name", "..", "", "x\\y", "a\u0000b"]) expect(suggestionPagePath("Topics", name)).toBeNull();
});
