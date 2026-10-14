import { beforeEach, expect, test } from "bun:test";
import type { DynamicToolUIPart } from "ai";
import { reconcileViewGenerations, syncViewGeneration } from "../src/react-app/domains/views/view-generation-sync";
import { useViewGenerationStore, viewGenerationId, type ViewDraftTab } from "../src/react-app/domains/views/view-generation";
import { usePanelTabStore } from "../src/react-app/domains/session/panel/panel-tab-store";
import { parseDynamicToolUIPart } from "../src/react-app/domains/session/sync/parse-tool-parts";
import { getAssistantRenderGroups } from "../src/components/chat/utils";

const context = { serverUrl: "local", workspaceId: "wiki", sessionId: "session" };
const id = viewGenerationId("local", "session", "call");
const pending = { type: "dynamic-tool", toolName: "view_create", toolCallId: "call", state: "input-streaming", input: {} } satisfies DynamicToolUIPart;
const saved = { version: 1, id: "11111111-1111-4111-8111-111111111111", owner: { kind: "wiki", id: "wiki" }, title: "Live", program: 'root = Text("Hello")', queries: {}, catalog: "legalwork-1", mode: "dashboard", updatedAt: 1, revision: "r1" };
const done = { ...pending, state: "output-available", output: saved } satisfies DynamicToolUIPart;
const opened: ViewDraftTab[] = [];
const open = (tab: ViewDraftTab) => { opened.push(tab); usePanelTabStore.getState().openTab("workspace:wiki", tab); };
beforeEach(() => { opened.length = 0; useViewGenerationStore.setState({ entries: {} }); usePanelTabStore.setState({ sessions: {} }); });

test("a view opens immediately with empty args, before the first program token", async () => {
  const part = parseDynamicToolUIPart({ type: "tool", id: "part", messageID: "message", sessionID: "session", callID: "call", tool: "view_create", state: { status: "pending", raw: "", input: {} } });
  expect(part).not.toBeNull();
  await syncViewGeneration(context, part!, open);
  expect(opened).toHaveLength(1);
  expect(useViewGenerationStore.getState().entries[id]).toMatchObject({ program: "", status: "streaming" });
});
test("partial arguments render progressively and completion replaces the existing tab", async () => {
  await syncViewGeneration(context, pending, open);
  const stream = (rawInput: string) => syncViewGeneration(context, { ...pending, callProviderMetadata: { opencode: { rawInput } } }, open);
  await stream('{"input":{"title":"Live","program":"root = Text(\\"Hel');
  expect(useViewGenerationStore.getState().entries[id].program).toBe('root = Text("Hel');
  await stream('{"input":{"title":"Live","program":"root = Text(\\"Hello\\")"}}');
  expect(useViewGenerationStore.getState().entries[id].program).toBe(saved.program);
  const late = stream('{"input":{"program":"short');
  await syncViewGeneration(context, done, open);
  await late;
  expect(opened).toHaveLength(1);
  expect(useViewGenerationStore.getState().entries[id]).toMatchObject({ status: "saved", saved });
  expect(usePanelTabStore.getState().sessions["workspace:wiki"].tabs).toMatchObject([{ type: "view", viewId: saved.id }]);
});
test("history never auto-opens and manual closure is respected while streaming", async () => {
  await syncViewGeneration(context, { ...done, toolCallId: "old-call" }, open);
  expect(opened).toHaveLength(0);
  await syncViewGeneration(context, pending, open);
  usePanelTabStore.getState().closeTab("workspace:wiki", id);
  await syncViewGeneration(context, { ...pending, input: { input: { program: saved.program } } }, open);
  await syncViewGeneration(context, done, open);
  expect(opened).toHaveLength(1);
  expect(usePanelTabStore.getState().sessions["workspace:wiki"].tabs).toHaveLength(0);
});
test("saved report JSON with runtime reminders resolves the preview and repairs historical cards", async () => {
  const report = { ...saved, mode: "report", owner: { kind: "workspace", id: "project" } };
  const output = JSON.stringify(report, null, 2) + '\n\n<system-reminder topic="project-folders">\nFolders: {"folders":["Reports"]}\n</system-reminder>' + '\n\n<system-reminder topic="sidebar">\nReport is open\n</system-reminder>';
  const part = parseDynamicToolUIPart({ type: "tool", id: "part", messageID: "message", sessionID: "session", callID: "call", tool: "view_create", state: { status: "completed", input: {}, output, title: "Report", metadata: { truncated: false }, time: { start: 1, end: 2 } } });
  expect(part).not.toBeNull();
  await syncViewGeneration(context, pending, open);
  await syncViewGeneration(context, part!, open);
  expect(useViewGenerationStore.getState().entries[id]).toMatchObject({ status: "saved", saved: report });
  expect(usePanelTabStore.getState().sessions["workspace:wiki"].tabs).toMatchObject([{ type: "view", viewId: report.id }]);
  useViewGenerationStore.getState().update(id, { ...useViewGenerationStore.getState().entries[id], saved: undefined, status: "failed", error: "The agent did not return a saved view." });
  await reconcileViewGenerations(context, [part!]);
  expect(useViewGenerationStore.getState().entries[id]).toMatchObject({ status: "saved", saved: report });
  expect(useViewGenerationStore.getState().entries[id].error).toBeUndefined();
  expect(opened).toHaveLength(1);
});
test("project dashboards stream beside their chat and stay in that project's tabs", async () => {
  const project = { ...context, workspaceId: "project" };
  const scope = "workspace:project";
  usePanelTabStore.getState().openTab(scope, { type: "chat", id: "chat:session", sessionId: "session", label: "Chat" });
  const openProject = (tab: ViewDraftTab) => usePanelTabStore.getState().openTab(scope, tab, "main", undefined, { besideChat: true });
  await syncViewGeneration(project, pending, openProject);
  expect(usePanelTabStore.getState().sessions[scope].panes[1].activeTabId).toBe(id);
  await syncViewGeneration(project, { ...pending, input: { input: { program: 'root = Text("Invoice' } } }, openProject);
  expect(useViewGenerationStore.getState().entries[id].program).toBe('root = Text("Invoice');
  await syncViewGeneration(project, { ...done, output: { ...saved, owner: { kind: "workspace", id: "project" } } }, openProject);
  expect(usePanelTabStore.getState().sessions[scope].tabs).toContainEqual(expect.objectContaining({ type: "view", owner: { kind: "workspace", id: "project" } }));
  expect(usePanelTabStore.getState().sessions["workspace:wiki"]).toBeUndefined();
});
test("view cards stay outside collapsed generic tool groups", () => {
  const groups = getAssistantRenderGroups([pending], false);
  expect(groups).toMatchObject([{ kind: "view", part: pending }]);
});

test("an idle snapshot ends abandoned previews and records failed tool results without reopening tabs", async () => {
  await syncViewGeneration(context, pending, open);
  await reconcileViewGenerations(context, [pending]);
  expect(useViewGenerationStore.getState().entries[id]).toMatchObject({ status: "failed", error: "Generation stopped before this view was saved." });
  await syncViewGeneration(context, pending, open);
  expect(opened).toHaveLength(1);
  await reconcileViewGenerations(context, [{ ...done, output: JSON.stringify({ ok: false, error: "Query limit exceeded" }) }]);
  expect(useViewGenerationStore.getState().entries[id]).toMatchObject({ status: "failed", error: "Query limit exceeded" });
  const retry = { ...done, toolCallId: "retry" };
  await reconcileViewGenerations(context, [retry]);
  expect(useViewGenerationStore.getState().entries[viewGenerationId("local", "session", "retry")].status).toBe("saved");
  expect(opened).toHaveLength(1);
});

test.each([0, 1600])("a streamed dashboard opens beside chat even with a source pane (width %d)", width => {
  const scope = "workspace:wiki";
  const store = usePanelTabStore.getState();
  store.setWorkspaceWidth(scope, width);
  store.openTab(scope, { type: "chat", id: "chat:session", sessionId: "session", label: "Chat" });
  store.openTab(scope, { type: "view-draft", id, generationId: id, serverUrl: "local", label: "Generating" }, "main", undefined, { besideChat: true });
  const layout = usePanelTabStore.getState().sessions[scope];
  expect(layout.panes).toHaveLength(2);
  expect(layout.panes[0].activeTabId).toBe("chat:session");
  expect(layout.panes[1].activeTabId).toBe(id);
});
