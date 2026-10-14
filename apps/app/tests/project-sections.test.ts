import { afterEach, expect, test } from "bun:test";
import type { WorkspaceSessionGroup } from "../src/app/types";
import { projectSectionGroups, reorderProjectSection } from "../src/react-app/domains/session/sidebar/project-sections";
import { useProjectSyncStore } from "../src/react-app/domains/workspace/project-sync-store";
import { readShellConfig, SHELL_CONFIG_STORAGE_KEY } from "../src/react-app/shell/shell-config";

const groups: WorkspaceSessionGroup[] = ["local", "outgoing", "incoming", "incoming-two"].map((id) => ({
  workspace: { id, name: id, path: `/${id}` }, status: "ready", sessions: [],
}));
const roles: Record<string, "owner" | "member"> = { outgoing: "owner", incoming: "member", "incoming-two": "member" };

afterEach(() => useProjectSyncStore.setState({ states: {}, roles: {} }));

test("Shared Projects contains recipients only, with local and outgoing projects kept in Projects", () => {
  expect(projectSectionGroups(groups, roles, true).map((group) => group.workspace.id)).toEqual(["incoming", "incoming-two"]);
  expect(projectSectionGroups(groups, roles, false).map((group) => group.workspace.id)).toEqual(["local", "outgoing"]);
  expect(projectSectionGroups(groups, {}, false)).toEqual(groups);
});

test("reordering either section preserves every project and the other section's order", () => {
  const ids = ["local", "incoming", "outgoing", "incoming-two"];
  expect(reorderProjectSection(ids, ["outgoing", "local"])).toEqual(["outgoing", "incoming", "local", "incoming-two"]);
  expect(reorderProjectSection(ids, ["incoming-two", "incoming"])).toEqual(["local", "incoming-two", "outgoing", "incoming"]);
  expect(reorderProjectSection(ids, [])).toEqual(ids);
});

test("received projects remain shared offline and stale roles clear when the overview changes", () => {
  const overview = { connected: false, revision: 1, states: {}, roles, contents: {}, removed: [] };
  useProjectSyncStore.getState().setOverview(overview);
  expect(projectSectionGroups(groups, useProjectSyncStore.getState().roles, true)).toHaveLength(2);
  useProjectSyncStore.getState().setOverview({ ...overview, roles: undefined });
  expect(useProjectSyncStore.getState().roles).toEqual({});
});

test("saved sidebar layouts gain Shared Projects and retain visibility and custom order on reload", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let saved = JSON.stringify({ sectionProjects: false, chatSectionOrder: ["sectionRecent", "sectionProjects", "navNewChat", "sectionPinned"] });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => key === SHELL_CONFIG_STORAGE_KEY ? saved : null } } });
  try {
    const migrated = readShellConfig();
    expect(migrated.sectionProjects).toBe(false);
    expect(migrated.sectionSharedProjects).toBe(true);
    expect(migrated.chatSectionOrder).toEqual(["sectionRecent", "sectionSharedProjects", "sectionProjects", "navNewChat", "sectionPinned", "sectionPinnedProjects"]);
    saved = JSON.stringify({ ...migrated, sectionSharedProjects: false, chatSectionOrder: ["sectionSharedProjects", "sectionProjects", "sectionRecent", "navNewChat", "sectionPinned"] });
    const reloaded = readShellConfig();
    expect(reloaded.sectionSharedProjects).toBe(false);
    expect(reloaded.chatSectionOrder[0]).toBe("sectionSharedProjects");
    saved = JSON.stringify({ chatSectionOrder: ["navNewChat", "sectionPinned", "sectionProjects", "sectionSharedProjects", "sectionRecent"] });
    expect(readShellConfig().chatSectionOrder).toEqual(["navNewChat", "sectionPinned", "sectionPinnedProjects", "sectionSharedProjects", "sectionProjects", "sectionRecent"]);
    const customPinned = ["navNewChat", "sectionPinned", "sectionProjects", "sectionSharedProjects", "sectionRecent", "sectionPinnedProjects"];
    saved = JSON.stringify({ chatSectionOrder: customPinned });
    expect(readShellConfig().chatSectionOrder).toEqual(customPinned);
    saved = JSON.stringify({ chatSectionOrder: ["sectionRecent", "sectionProjects", "sectionSharedProjects", "navNewChat", "sectionPinned"] });
    expect(readShellConfig().chatSectionOrder).toEqual(["sectionRecent", "sectionProjects", "sectionSharedProjects", "navNewChat", "sectionPinned", "sectionPinnedProjects"]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
