// LAWOSS #460: prehľad OKF pri nečinnosti nečíta celý strom všetkých klientov každých 15 s. Číta sa po zápise agenta
// v chate, pri návrate do okna (najviac raz za 30 s), pri otvorení stránky a inak najviac raz za 5 minút.
import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { okfOverviewQueryOptions, okfScope, type OkfScopeClient } from "../src/lawoss/okf/read-model";
import { chatsFinished, OKF_IDLE_REFRESH_MS, revalidateOkfAfterAgentTool, revalidateOkfAfterAgentTurn, revalidateOkfOnFocus, writesPracticeFiles } from "../src/lawoss/okf/overview-refresh";
import { lawossToolCategory } from "../src/lawoss/chat/tool-labels";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { __applySessionSyncEventForTest, __createWorkspaceSessionSyncForTest, trackWorkspaceSessionSync } from "../src/react-app/domains/session/sync/session-sync";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

const workspace = (id: string): RouteWorkspace => ({ id, path: `/practice/${id}`, name: id, workspaceType: "local" });
const clients = Array.from({ length: 24 }, (_, index) => workspace(`K${index}`));
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

/** Server s počítadlom výpisov priečinkov: každý klient má prázdny koreň; `delayMs` napodobní pomalý disk. */
function countingServer(delayMs = 0) {
  const counter = { lists: 0 };
  const client: OkfScopeClient = {
    listWorkspaceDirectory: async () => {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      counter.lists += 1; return { path: "", entries: [], truncated: false };
    },
    readWorkspaceFile: async () => { throw new Error("not found"); },
    lawossOfficeMemory: async expected => ({ practiceRoot: expected, directory: null, files: [], problems: [], truncated: false }),
  };
  return { client, counter };
}

async function observed(queries: QueryClient, delayMs = 0) {
  const { client, counter } = countingServer(delayMs);
  const scope = okfScope(clients, clients[0]!, "/practice")!;
  const options = okfOverviewQueryOptions({ client, baseUrl: "http://synthetic", token: "synthetic", authGeneration: 1 }, scope, "2026-11-16", queries);
  const observer = new QueryObserver(queries, options);
  const unsubscribe = observer.subscribe(() => {});
  while (!observer.getCurrentResult().data) await settle();
  return { counter, observer, unsubscribe, options };
}

afterEach(() => { getReactQueryClient().clear(); });

describe("#460 obnova prehľadu OKF", () => {
  test("pri nečinnosti najviac raz za 5 minút, nie každých 15 s", async () => {
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { counter, unsubscribe, options } = await observed(queries);
    try {
      const perRead = counter.lists;
      expect(perRead).toBeGreaterThanOrEqual(clients.length);
      const interval = options.refetchInterval();
      expect(interval).toBeGreaterThanOrEqual(OKF_IDLE_REFRESH_MS);
      // 10 minút nečinnosti: predtým 40 čítaní celej praxe, teraz najviac 2.
      expect(Math.floor(600_000 / interval) * perRead).toBeLessThanOrEqual(2 * perRead);
      expect(options.refetchIntervalInBackground).toBe(false);
    } finally { unsubscribe(); queries.clear(); }
  });

  test("zápis agenta: čítací nástroj nič, zapisujúce nástroje tesne po sebe jedno čítanie, koniec ťahu hneď", async () => {
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { counter, observer, unsubscribe } = await observed(queries);
    try {
      const perRead = counter.lists;
      revalidateOkfAfterAgentTool(queries, "lawoss_documents_read", { settleMs: 5 });
      await settle();
      expect(counter.lists).toBe(perRead);
      revalidateOkfAfterAgentTool(queries, "lawoss_memory_write", { settleMs: 5 });
      revalidateOkfAfterAgentTool(queries, "lawoss_files", { settleMs: 5 });
      await settle();
      while (observer.getCurrentResult().isFetching) await settle();
      expect(counter.lists).toBe(2 * perRead);
      revalidateOkfAfterAgentTurn(queries);
      await settle();
      while (observer.getCurrentResult().isFetching) await settle();
      expect(counter.lists).toBe(3 * perRead);
    } finally { unsubscribe(); queries.clear(); }
  });

  test("ťah s mnohými príkazmi na pomalom disku: najviac jedno čítanie za interval a rozbehnuté čítanie dobehne", async () => {
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { counter, observer, unsubscribe } = await observed(queries, 4);
    try {
      const perRead = counter.lists;
      const started = Date.now();
      // A successful shell command every 20 ms for 600 ms; a read takes ~50 ms or more.
      while (Date.now() - started < 600) {
        revalidateOkfAfterAgentTool(queries, "legalwork_shell", { settleMs: 5, minIntervalMs: 150 });
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await new Promise(resolve => setTimeout(resolve, 200));
      while (observer.getCurrentResult().isFetching) await settle();
      const reads = counter.lists / perRead - 1;
      // Every started read finished (no cancelled partial read) and their number is bounded by the interval.
      expect(Number.isInteger(reads)).toBe(true);
      expect(reads).toBeGreaterThanOrEqual(2);
      expect(reads).toBeLessThanOrEqual(6);
    } finally { unsubscribe(); queries.clear(); }
  });

  test("chat ktoréhokoľvek klienta, ktorý prestal bežať, je koniec ťahu", () => {
    expect(chatsFinished([], ["a"])).toBe(false);
    expect(chatsFinished(["a"], ["a", "b"])).toBe(false);
    expect(chatsFinished(["a", "b"], ["b"])).toBe(true);
    expect(chatsFinished(["a"], [])).toBe(true);
  });

  test("návrat do okna číta najviac raz za 30 s", async () => {
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { counter, observer, unsubscribe } = await observed(queries);
    try {
      const perRead = counter.lists;
      expect(revalidateOkfOnFocus(queries, 1_000_000)).toBe(true);
      expect(revalidateOkfOnFocus(queries, 1_010_000)).toBe(false);
      await settle();
      while (observer.getCurrentResult().isFetching) await settle();
      expect(counter.lists).toBe(2 * perRead);
      expect(revalidateOkfOnFocus(queries, 1_030_000)).toBe(true);
    } finally { unsubscribe(); queries.clear(); }
  });

  test("zapisujúce nástroje LAWOSS sú presne tie so zápisom v kategóriách krokov", () => {
    for (const tool of ["lawoss_files", "lawoss_memory_write", "lawoss_memory_deadline", "lawoss_documents_export", "legalwork_shell"]) {
      expect({ tool, category: lawossToolCategory(tool), writes: writesPracticeFiles(tool) }).toMatchObject({ tool, writes: true });
      expect(["write", "edit", "command"]).toContain(lawossToolCategory(tool));
    }
    for (const tool of ["lawoss_documents_read", "lawoss_documents_list", "lawoss_documents_prepare", "lawoss_documents_validate", "legalwork_project_remote_folders", "read", "glob"])
      expect({ tool, writes: writesPracticeFiles(tool) }).toEqual({ tool, writes: false });
    for (const tool of ["write", "edit", "apply_patch", "lawoss_new_client"]) expect(writesPracticeFiles(tool)).toBe(true);
  });

  test("chat: úspešný zapisujúci nástroj a koniec ťahu označia prehľad na nové čítanie", async () => {
    const cache = getReactQueryClient();
    const input = { workspaceId: "okf-460", baseUrl: "http://127.0.0.1:1234", legalworkToken: "token" };
    const sessionId = "ses-460";
    const cleanup = __createWorkspaceSessionSyncForTest(input);
    const release = trackWorkspaceSessionSync(input, sessionId);
    const key = ["okf-overview", "scope", "http://synthetic", "synthetic", 1, "2026-11-16"];
    const fresh = () => { cache.setQueryData(key, { marker: true }); expect(cache.getQueryState(key)?.isInvalidated).toBe(false); };
    try {
      const event = (type: string, data: object) => __applySessionSyncEventForTest(input, { type, id: "event", created: 1,
        durable: { aggregateID: sessionId, seq: "1", version: 1 }, data: { sessionID: sessionId, assistantMessageID: "assistant", ...data } } as never);
      fresh();
      event("session.step.started", { model: { providerID: "fixture", id: "fixture" } });
      event("session.tool.input.started", { id: "call-1", name: "lawoss_memory_write" });
      event("session.tool.called", { id: "call-1", input: { matter: "Spisy/M001" } });
      event("session.tool.success", { id: "call-1", content: [{ type: "text", text: "written" }], metadata: {} });
      const deadline = Date.now() + 5_000;
      while (!cache.getQueryState(key)?.isInvalidated) { if (Date.now() > deadline) throw new Error("tool success did not revalidate the overview"); await settle(); }
      fresh();
      event("session.idle", {});
      expect(cache.getQueryState(key)?.isInvalidated).toBe(true);
    } finally { release(); cleanup(); }
  });
});
