import { afterEach, describe, expect, test } from "bun:test";
import { createPanelTabStore, EVALS_PANEL_SESSION_ID, workspacePanelKey } from "../src/react-app/domains/session/panel/panel-tab-store";
import { workflowsPanelKey } from "../src/react-app/domains/session/panel/panel-scope";
import { getDocumentDiscardPrompt, registerUnsavedDocument, resolveDocumentDiscardPrompt } from "../src/react-app/domains/session/artifacts/docx-document-state";

afterEach(() => { resolveDocumentDiscardPrompt(false); });

describe("workflow workspace tabs", () => {
  test("workflows and their files share a dedicated workspace without changing project or evaluation tabs", () => {
    const store = createPanelTabStore();
    const panels = store.getState();
    const scope = workflowsPanelKey("project-a");
    const workflow = { id: "workflow-a", type: "workflow", label: "Review" } satisfies import("../src/react-app/domains/session/panel/panel-tab-store").PanelTab;
    panels.openTab(workspacePanelKey("project-a"), { id: "project-file", type: "artifact", label: "Agreement", value: "agreement.pdf", preview: "pdf" });
    panels.openTab(EVALS_PANEL_SESSION_ID, { id: "evaluation", type: "artifact", label: "Results", value: "results.md", preview: "markdown" });
    const before = store.getState().sessions;
    panels.openTab(scope, workflow);
    panels.openTab(scope, { id: "workflow-file", type: "workflow-resource", label: "playbook.md" });
    panels.openTab(scope, { id: "workflow-b", type: "workflow", label: "Diligence" });
    panels.openTab(scope, workflow);
    const after = store.getState().sessions;
    expect(after[scope].tabs.map(tab => tab.id)).toEqual(["workflow-a", "workflow-file", "workflow-b"]);
    expect(after[scope].activeTabId).toBe("workflow-a");
    expect(after[workspacePanelKey("project-a")]).toBe(before[workspacePanelKey("project-a")]);
    expect(after[EVALS_PANEL_SESSION_ID]).toBe(before[EVALS_PANEL_SESSION_ID]);
    expect(after[workflowsPanelKey("project-b")]).toBeUndefined();
  });

  test("switching away from an unsaved Office resource preserves it, but closing it still asks", () => {
    const store = createPanelTabStore();
    const panels = store.getState();
    const scope = workflowsPanelKey("project-a");
    const resource = { id: "office-resource", type: "workflow-resource", label: "template.docx" } satisfies import("../src/react-app/domains/session/panel/panel-tab-store").PanelTab;
    panels.openTab(scope, resource);
    let discarded = false;
    const unregister = registerUnsavedDocument(resource.id, resource.label, () => true, () => { discarded = true; });
    try {
      panels.openTab(scope, { id: "workflow", type: "workflow", label: "Review" });
      expect(store.getState().sessions[scope].activeTabId).toBe("workflow");
      panels.selectTab(scope, resource.id);
      panels.selectTab(scope, "workflow");
      expect(store.getState().sessions[scope].activeTabId).toBe("workflow");
      expect(discarded).toBe(false);
      expect(getDocumentDiscardPrompt()).toBeNull();
      panels.closeTab(scope, resource.id);
      expect(getDocumentDiscardPrompt()?.names).toEqual([resource.label]);
      resolveDocumentDiscardPrompt(false);
      expect(store.getState().sessions[scope].tabs).toHaveLength(2);
      panels.closeTab(scope, resource.id);
      resolveDocumentDiscardPrompt(true);
      expect(discarded).toBe(true);
      expect(store.getState().sessions[scope].tabs.map(tab => tab.id)).toEqual(["workflow"]);
    } finally { unregister(); }
  });
});
