import { afterEach, expect, test } from "bun:test";
import type { PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client";
import { createClient } from "../src/app/lib/opencode";
import type { PendingPermission, PendingQuestion } from "../src/app/types";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { createInteractionSnapshot, permissionKey, questionKey, refreshWorkspaceInteractions } from "../src/react-app/domains/session/sync/interaction-state";
import { __applySessionSyncEventForTest, __createWorkspaceSessionSyncForTest } from "../src/react-app/domains/session/sync/session-sync";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";

/**
 * LAWOSS: a client workspace has one engine instance per folder: the client root and each case
 * subfolder. Their syncs recover pending cards side by side; one folder's recovery must never
 * remove a card that another folder's engine is still waiting on (review A2, I-1).
 */
const workspaceId = "lawoss-folders";
const root = "/prax/Klient_A", matter = "/prax/Klient_A/Spisy/M001-Úhrada";
const queryClient = getReactQueryClient();
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  queryClient.clear();
  useSessionActivityStore.setState({ recordsByWorkspaceId: {}, statusesByWorkspaceId: {} });
});

const permission = (id: string, sessionID: string): PermissionRequest => ({ id, sessionID, permission: "edit", patterns: ["zmena.txt"], metadata: {}, always: [] });
const question = (id: string, sessionID: string): QuestionRequest => ({ id, sessionID, questions: [{ header: "Voľba", question: "Pokračovať?", options: [{ label: "Áno", description: "Pokračovať" }] }] });
const session = (id: string, directory: string): Session => ({ id, title: id, slug: id, projectID: "global", directory, version: "1", time: { created: 1, updated: 2 } });

/** Engine na skúšku s dvoma inštanciami priečinka; každá vráti len svoje čakajúce žiadosti. */
function engine() {
  const pending: Record<string, { permissions: PermissionRequest[]; questions: QuestionRequest[] }> = {
    [root]: { permissions: [permission("per_root", "chat-klienta")], questions: [question("que_root", "chat-klienta")] },
    [matter]: { permissions: [permission("per_case", "chat-pripadu")], questions: [question("que_case", "chat-pripadu")] },
  };
  const server = Bun.serve({ port: 0, fetch(request) {
    const url = new URL(request.url);
    const folder = pending[url.searchParams.get("directory") ?? ""];
    if (!folder) return new Response(null, { status: 400 });
    if (url.pathname === "/permission") return Response.json(folder.permissions);
    if (url.pathname === "/question") return Response.json(folder.questions);
    if (url.pathname === "/api/permission/request" || url.pathname === "/api/question/request") return Response.json({ data: [], location: {} });
    if (url.pathname.startsWith("/session/")) return Response.json(session(url.pathname.slice("/session/".length), url.searchParams.get("directory") ?? ""));
    return new Response(null, { status: 404 });
  } });
  cleanups.push(() => server.stop(true));
  const refresh = (directory: string) => refreshWorkspaceInteractions({ client: createClient(server.url.origin, directory), workspaceId, directory,
    snapshot: createInteractionSnapshot(), isCurrent: () => true, onSessionUpdated: () => {} });
  return { pending, refresh, url: server.url.origin };
}
const cards = (sessionId: string) => ({
  permissions: (queryClient.getQueryData<PendingPermission[]>(permissionKey(workspaceId, sessionId)) ?? []).map((item) => item.id),
  questions: (queryClient.getQueryData<PendingQuestion[]>(questionKey(workspaceId, sessionId)) ?? []).map((item) => item.id),
});

test("obnova priečinka prípadu nezmaže karty chatu klienta a naopak, ani pri prepínaní tam a späť", async () => {
  const { refresh, pending } = engine();
  await refresh(root);
  expect(cards("chat-klienta")).toEqual({ permissions: ["per_root"], questions: ["que_root"] });
  // Otvorenie chatu prípadu pripojí synchronizáciu jeho priečinka.
  await refresh(matter);
  expect(cards("chat-klienta")).toEqual({ permissions: ["per_root"], questions: ["que_root"] });
  expect(cards("chat-pripadu")).toEqual({ permissions: ["per_case"], questions: ["que_case"] });
  // Prepínanie chatov (každé pripojenie znova obnoví svoj priečinok).
  for (const directory of [root, matter, root, matter, root]) await refresh(directory);
  expect(cards("chat-klienta")).toEqual({ permissions: ["per_root"], questions: ["que_root"] });
  expect(cards("chat-pripadu")).toEqual({ permissions: ["per_case"], questions: ["que_case"] });
  // Vybavená žiadosť zmizne len pri obnove vlastného priečinka.
  pending[matter] = { permissions: [], questions: [] };
  await refresh(root);
  expect(cards("chat-pripadu")).toEqual({ permissions: ["per_case"], questions: ["que_case"] });
  await refresh(matter);
  expect(cards("chat-pripadu")).toEqual({ permissions: [], questions: [] });
  expect(cards("chat-klienta")).toEqual({ permissions: ["per_root"], questions: ["que_root"] });
  // Indikátor čakania (sidebar) chatu klienta ostal.
  expect(useSessionActivityStore.getState().recordsByWorkspaceId[workspaceId]?.["chat-klienta"]?.waitingPermissionIds).toEqual(["per_root"]);
});

test("karta z udalosti synchronizácie prípadu prežije pripojenie synchronizácie koreňa (a naopak)", async () => {
  const { refresh, pending, url } = engine();
  pending[root] = { permissions: [], questions: [] };
  pending[matter] = { permissions: [], questions: [] };
  const rootSync = { workspaceId, baseUrl: url, legalworkToken: "fixture", directory: root };
  const caseSync = { workspaceId, baseUrl: url, legalworkToken: "fixture", directory: matter };
  cleanups.push(__createWorkspaceSessionSyncForTest(rootSync), __createWorkspaceSessionSyncForTest(caseSync));
  __applySessionSyncEventForTest(caseSync, { type: "permission.asked", properties: permission("per_live_case", "chat-pripadu") });
  __applySessionSyncEventForTest(rootSync, { type: "question.asked", properties: question("que_live_root", "chat-klienta") });
  // Engine ich už vedie (asked pred obnovou): zoznamy vracajú tie isté žiadosti.
  pending[matter] = { permissions: [permission("per_live_case", "chat-pripadu")], questions: [] };
  pending[root] = { permissions: [], questions: [question("que_live_root", "chat-klienta")] };
  for (const directory of [root, matter, root]) await refresh(directory);
  expect(cards("chat-pripadu").permissions).toEqual(["per_live_case"]);
  expect(cards("chat-klienta").questions).toEqual(["que_live_root"]);
});
