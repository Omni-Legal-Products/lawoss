import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createPanelTabStore, type ArtifactPanelTab } from "../src/react-app/domains/session/panel/panel-tab-store";
import { viewPanelTab } from "../src/react-app/domains/views/view-reference";
import { wikiPanelTab } from "../src/react-app/domains/wiki/wiki-tabs";
import { connectPanelNavigationHistory, type NavigationEntry, type PanelHistoryHost } from "../src/react-app/shell/panel-navigation-history";

const scope = "workspace:history-test";
const usePanelTabStore = createPanelTabStore();
const file = (id: string): ArtifactPanelTab => ({ id, type: "artifact", label: id, value: `${id}.txt`, preview: "text" });
const store = () => usePanelTabStore.getState();
const active = (key = scope) => {
  const state = store().sessions[key];
  return state?.panes.find(pane => pane.id === state.focusedPaneId)?.activeTabId;
};
const cleanups: Array<() => void> = [];
beforeEach(() => usePanelTabStore.setState({ sessions: {}, opening: {} }));
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); });

function history(initialScope = scope) {
  const entries: NavigationEntry[] = [{ key: "0", href: "/workspace/a", state: { retained: "route state" } }];
  let index = 0, serial = 0, currentScope = initialScope;
  let work: (() => void) | undefined;
  let disconnect = () => {};
  let connectedKey = "";
  const host: PanelHistoryHost = {
    current: () => entries[index],
    replace: state => { entries[index] = { ...entries[index], state }; },
    push: state => { entries.splice(index + 1); entries.push({ ...entries[index], key: String(++serial), state }); index++; },
    schedule: callback => { work = callback; return () => { if (work === callback) work = undefined; }; },
  };
  const mount = () => { disconnect(); connectedKey = entries[index].key; disconnect = connectPanelNavigationHistory(currentScope, usePanelTabStore, host); };
  const flush = () => { const callback = work; work = undefined; callback?.(); if (connectedKey !== entries[index].key) mount(); };
  mount();
  cleanups.push(() => disconnect());
  return {
    entries, flush,
    current: () => entries[index],
    go: (delta: number, key = currentScope) => { index = Math.max(0, Math.min(entries.length - 1, index + delta)); currentScope = key; mount(); },
    route: (href: string, key = currentScope) => { entries.splice(index + 1); entries.push({ key: String(++serial), href, state: null }); index++; currentScope = key; flush(); },
  };
}

describe("shared route and tab navigation history", () => {
  test("opening and selecting tabs supports Back, Forward and branching without duplicate visits", () => {
    store().openTab(scope, file("A"));
    const h = history();
    store().openTab(scope, file("B")); h.flush();
    store().selectTab(scope, "A"); h.flush();
    expect(h.entries).toHaveLength(3);
    expect(h.current().state).toMatchObject({ retained: "route state" });
    h.go(-1); expect(active()).toBe("B");
    h.go(-1); expect(active()).toBe("A");
    h.go(1); expect(active()).toBe("B");
    store().openTab(scope, file("C")); h.flush();
    expect(h.entries).toHaveLength(3);
    h.go(-1); expect(active()).toBe("B");
    h.go(1); expect(active()).toBe("C");
    h.flush(); expect(h.entries).toHaveLength(3);
  });
  test("a route plus tab change is one visit, and another workspace restores its own tab", () => {
    store().openTab(scope, file("A"));
    const h = history();
    store().openTab(scope, file("B"));
    h.route("/workspace/a/session/chat");
    expect(h.entries).toHaveLength(2);
    h.go(-1); expect(active()).toBe("A");
    h.go(1); expect(active()).toBe("B");
    const other = "workspace:other-wiki";
    store().openTab(other, file("X")); h.route("/wikis/other", other);
    store().openTab(other, file("Y")); h.flush();
    h.go(-1); expect(active(other)).toBe("X");
    h.go(-1, scope); expect(active()).toBe("B");
    h.go(1, other); expect(active(other)).toBe("X");
  });
  test("split focus restores selection without resetting tabs, layout, sizes or live editor metadata", () => {
    store().openTab(scope, file("A"));
    store().openTab(scope, file("B"), "main", "right");
    store().selectTab(scope, "A");
    const h = history();
    const layout = store().sessions[scope].tree;
    store().selectTab(scope, "B"); h.flush();
    store().updateTabLabel(scope, "B", "Live title"); h.flush();
    store().openTab("workspace:background", file("background")); h.flush();
    expect(h.entries).toHaveLength(2);
    h.go(-1); expect(active()).toBe("A");
    h.go(1); expect(active()).toBe("B");
    expect(store().sessions[scope].tree).toEqual(layout);
    expect(store().sessions[scope].panes).toHaveLength(2);
    expect(store().sessions[scope].tabs.find(tab => tab.id === "B")?.label).toBe("Live title");
  });
  test("closing a tab replaces the current stop; revisiting an earlier closed tab reopens it", () => {
    store().openTab(scope, file("A")); const h = history();
    store().openTab(scope, file("B")); h.flush();
    store().selectTab(scope, "A"); h.flush();
    store().closeTab(scope, "B"); h.flush();
    h.go(-1); expect(active()).toBe("B");
    expect(store().sessions[scope].tabs).toHaveLength(2);
    store().closeTab(scope, "B"); h.flush();
    expect(active()).toBe("A");
    expect(h.entries).toHaveLength(3);
  });
  test("replacing a preview is a visit and heading links restore their original target", () => {
    const page = (path: string, anchor?: string) => wikiPanelTab("http://local", "wiki", { kind: "page", path, anchor }, path);
    store().openTab(scope, page("A.md"), undefined, undefined, { preview: true });
    const h = history();
    store().openTab(scope, page("B.md"), undefined, undefined, { preview: true }); h.flush();
    expect(h.entries).toHaveLength(2);
    h.go(-1); expect(active()).toBe(page("A.md").id);
    store().openTab(scope, page("A.md", "Sources")); h.flush();
    h.go(-1);
    expect(store().sessions[scope].tabs.find(tab => tab.id === page("A.md").id)).toMatchObject({ location: { anchor: undefined } });
    h.go(1);
    expect(store().sessions[scope].tabs.find(tab => tab.id === page("A.md").id)).toMatchObject({ location: { anchor: "Sources" } });
  });
  test("the first tab and background metadata do not manufacture a blank history stop", () => {
    const h = history();
    store().openTab(scope, file("A")); h.flush();
    store().selectTab(scope, "A"); h.flush();
    store().updateTabLabel(scope, "A", "Updated"); h.flush();
    expect(h.entries).toHaveLength(1);
  });
  test("saving a wiki suggestion replaces the current history stop with its saved page", () => {
    store().openTab(scope, file("Source"));
    const h = history();
    store().openTab(scope, file("Suggestion")); h.flush();
    const saved = wikiPanelTab("http://local", "wiki", { kind: "page", path: "Knowledge.md" }, "Knowledge");
    store().replaceTab("Suggestion", saved); h.flush();
    expect(h.entries).toHaveLength(2);
    h.go(-1); expect(active()).toBe("Source");
    h.go(1); expect(active()).toBe(saved.id);
  });
  test("live generated views and browser tabs retain their current state when revisited", () => {
    const browser = { id: "browser", type: "browser", label: "Browser", url: "https://example.com", favicon: null, status: "ready", canGoBack: false, canGoForward: false } satisfies Parameters<ReturnType<typeof store>["openTab"]>[1];
    store().openTab(scope, browser);
    const h = history();
    const draft = { id: "draft", type: "view-draft", label: "Streaming", serverUrl: "http://local", generationId: "draft" } satisfies Parameters<ReturnType<typeof store>["openTab"]>[1];
    store().openTab(scope, draft); h.flush();
    h.go(-1); expect(active()).toBe(browser.id);
    h.go(1); expect(active()).toBe(draft.id);
    const saved = viewPanelTab("http://local", { owner: { kind: "workspace", id: "a" }, viewId: "a09a8e3f-9186-4cc8-9e46-b0d778e8f204" });
    store().resolveViewTab(draft.id, saved); h.flush();
    expect(h.entries).toHaveLength(2);
    h.go(-1); expect(active()).toBe(browser.id);
    h.go(1); expect(active()).toBe(saved.id);
  });
});
