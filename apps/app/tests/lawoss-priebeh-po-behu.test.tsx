/**
 * N-A8-6 (regresia 30. 10. 2026): po skončení behu ostal nad composerom pruh „Priebeh · 1/3“, hoci agent už nepracoval.
 * SSR celého SessionSurface so syntetickým plánom: nečinný chat pruh nemá, bežiaci chat (aj čakajúci na povolenie) áno.
 */
import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import type { TodoItem } from "../src/app/types";
import { createLegalworkServerClient, type LegalworkSessionSnapshot } from "../src/app/lib/legalwork-server";
import { snapshotKey } from "../src/react-app/domains/session/sync/session-sync";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import { planBarVisible } from "../src/lawoss/chat/plan-bar";

const WORKSPACE = "synthetic-plan-workspace";
const SESSION = "synthetic-plan-chat";
const todos: TodoItem[] = [
  { id: "a", content: "Prečítať syntetickú zmluvu", status: "completed", priority: "high" },
  { id: "b", content: "Porovnať s návrhom", status: "in_progress", priority: "high" },
  { id: "c", content: "Napísať zhrnutie", status: "pending", priority: "high" },
];

/** Stav chatu, ako ho vráti server: beh skončil (`idle`) alebo beží (`busy`). Plán agenta ostáva nedokončený. */
function seedChat(status: LegalworkSessionSnapshot["status"]) {
  const snapshot: LegalworkSessionSnapshot = {
    session: { id: SESSION, title: "Syntetický chat", time: { created: 1, updated: 2 }, version: "0" },
    messages: [], todos, status,
  };
  getReactQueryClient().setQueryData(snapshotKey(WORKSPACE, SESSION), snapshot);
}

afterEach(() => {
  getReactQueryClient().clear();
  useSessionActivityStore.setState({ recordsByWorkspaceId: {}, statusesByWorkspaceId: {} });
});

/** Úložisko pre SSR (composer číta localStorage); pôvodné deskriptory sa vrátia aj po chybe. */
async function withStorage<T>(run: () => Promise<T>): Promise<T> {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const storage: Storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: (k) => { values.delete(k); }, clear: () => values.clear(), key: (i) => [...values.keys()][i] ?? null, get length() { return values.size; } };
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage, fetch: globalThis.fetch, addEventListener: () => {}, removeEventListener: () => {} } });
    return await run();
  } finally {
    try { if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window"); }
    finally { if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage); else Reflect.deleteProperty(globalThis, "localStorage"); }
  }
}

async function renderChat(): Promise<string> {
  return withStorage(async () => {
    const [{ SessionSurface }, { LocalProvider }, { ShellConfigProvider }, { LegalworkControlProvider }, { WorkspaceProvider }] = await Promise.all([
      import("../src/react-app/domains/session/surface/session-surface"), import("../src/react-app/kernel/local-provider"), import("../src/react-app/shell/shell-config"),
      import("../src/react-app/shell/control/control-provider"), import("../src/react-app/shell/workspace-provider"),
    ]);
    const surface = createElement(SessionSurface, {
      client: createLegalworkServerClient({ baseUrl: "http://127.0.0.1:9", token: "synthetic" }), workspaceId: WORKSPACE, workspaceRoot: "/synthetic/selected", sessionId: SESSION,
      opencodeBaseUrl: "http://127.0.0.1:9", legalworkToken: "synthetic", developerMode: false, modelLabel: "Synthetic", onModelClick: () => {}, modelPickerOpen: false,
      selectedModel: { providerID: "synthetic", modelID: "synthetic" }, onModelPickerOpenChange: () => {}, onModelChange: () => {}, onSendDraft: () => {}, onDraftChange: () => {},
      attachmentsEnabled: false, attachmentsDisabledReason: null, modelVariantLabel: "Synthetic", modelVariant: null, onModelVariantChange: () => {}, agentLabel: "Synthetic",
      selectedAgent: null, listAgents: async () => [], onSelectAgent: () => {}, listCommands: async () => [], recentFiles: [], searchFiles: async () => [],
      isRemoteWorkspace: false, isSandboxWorkspace: false, todos,
    });
    return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(QueryClientProvider, { client: getReactQueryClient() },
      createElement(LocalProvider, null, createElement(ShellConfigProvider, null, createElement(LegalworkControlProvider, null,
        createElement(WorkspaceProvider, { client: null, selectedWorkspaceRoot: "/synthetic/selected" }, surface)))))));
  });
}

test("nečinný chat s nedokončeným plánom nemá pruh „Priebeh“", async () => {
  seedChat({ type: "idle" });
  const html = await renderChat();
  expect(html).toContain('role="textbox"'); // composer sa vykreslil, nejde o prázdny render
  expect(html).not.toContain("Progress · 1/3");
});

test("počas behu pruh „Priebeh · 1/3“ ostáva", async () => {
  seedChat({ type: "busy" });
  expect(await renderChat()).toContain("Progress · 1/3");
});

test("pravidlo: pruh len počas behu a len s nedokončeným krokom", () => {
  expect(planBarVisible(todos, true)).toBe(true);
  expect(planBarVisible(todos, false)).toBe(false);
  expect(planBarVisible(todos.map((todo) => ({ ...todo, status: "completed" })), true)).toBe(false);
});
