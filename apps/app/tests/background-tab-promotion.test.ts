import { expect, test } from "bun:test";
import { openBackgroundTab, paneRightOfChat } from "../src/react-app/domains/session/background/open-background-tab";
import { usePanelTabStore } from "../src/react-app/domains/session/panel/panel-tab-store";

test("promotion uses the owning chat's local project and always opens beside it", () => {
  const scope = "workspace:mini-promotion-test";
  const store = usePanelTabStore.getState();
  store.adoptChat(scope, "mini-task", "Task");
  const chat = usePanelTabStore.getState().sessions[scope].panes[0].id;
  const file = { id: "file:mini.md", type: "artifact", label: "Mini", value: "mini.md", preview: "markdown" } satisfies Parameters<typeof openBackgroundTab>[2];
  try {
    openBackgroundTab("workspace:server-id", "mini-task", file);
    let state = usePanelTabStore.getState().sessions[scope];
    expect(state.panes).toHaveLength(2);
    const right = paneRightOfChat(state.tree, chat);
    expect(right).toBeDefined();
    expect(state.panes.find(pane => pane.id === chat)?.tabIds).toEqual(["chat:mini-task"]);
    expect(state.panes.find(pane => pane.id === right)?.tabIds).toEqual([file.id]);
    expect(usePanelTabStore.getState().sessions["workspace:server-id"]).toBeUndefined();
    openBackgroundTab(scope, "mini-task", { ...file, id: "file:second.md", value: "second.md" });
    state = usePanelTabStore.getState().sessions[scope];
    expect(state.panes).toHaveLength(2);
    expect(state.panes.find(pane => pane.id === right)?.tabIds).toEqual([file.id, "file:second.md"]);
  } finally {
    const { [scope]: removed, ...sessions } = usePanelTabStore.getState().sessions;
    usePanelTabStore.setState({ sessions });
  }
});
