import { expect, test } from "bun:test";
import { QueryClient, QueryObserver, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { useOkfScope, okfScope, okfOverviewQueryOptions, type OkfScopeClient } from "../src/lawoss/okf/read-model";
import { PracticeCoverage } from "../src/lawoss/okf/practice-coverage";
import { OkfPageState } from "../src/lawoss/domains/okf-page";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

const workspace = (id: string): RouteWorkspace => ({ id, path: `/practice/${id}`, name: id, workspaceType: "local" });
const a = workspace("A"), b = workspace("B");
const emptyServer: OkfScopeClient = {
  listWorkspaceDirectory: async () => ({ path: "", entries: [], truncated: false }),
  readWorkspaceFile: async () => { throw new Error("not found"); },
  lawossOfficeMemory: async expected => ({ practiceRoot: expected, directory: null, files: [], problems: [], truncated: false }),
};

test("late_old_scope_response_is_ignored_and_removed_client_not_restored", async () => {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let admitted!: () => void;
  const started = new Promise<void>(resolve => { admitted = resolve; });
  let first = true;
  const client: OkfScopeClient = { ...emptyServer, listWorkspaceDirectory: async (...args) => {
    if (first) { first = false; admitted(); await barrier; }
    return emptyServer.listWorkspaceDirectory(...args);
  } };
  const connection = { client, baseUrl: "http://synthetic", token: "synthetic", authGeneration: 1 };
  const full = okfScope([a,b],a,"/practice")!, reduced = okfScope([a],a,"/practice")!;
  const observer = new QueryObserver(queries,okfOverviewQueryOptions(connection,full,"2026-10-17",queries));
  const received: number[] = [];
  const unsubscribe = observer.subscribe(result => { if (result.data) received.push(result.data.coverage.sources.length); });
  try {
    await started;
    observer.setOptions(okfOverviewQueryOptions(connection,reduced,"2026-10-17",queries));
    await observer.refetch();
    release();
    // Await the original operation too: a transport ignoring abort cannot publish old scope.
    await queries.cancelQueries({ queryKey: okfOverviewQueryOptions(connection,full,"2026-10-17",queries).queryKey });
    expect(observer.getCurrentResult().data?.coverage.sources).toHaveLength(2); // A + Office
    expect(received.every(count => count === 2)).toBe(true);
  } finally { release(); unsubscribe(); queries.clear(); }
});

test("server_auth_generation_and_midnight_have_distinct_cache_owners", () => {
  const queries = new QueryClient();
  const scope = okfScope([a],a,"/practice")!;
  const connection = { client: emptyServer, baseUrl: "http://synthetic", token: "synthetic", authGeneration: 1 };
  const key = okfOverviewQueryOptions(connection,scope,"2026-10-17",queries).queryKey;
  expect(okfOverviewQueryOptions({ ...connection, authGeneration: 2 },scope,"2026-10-17",queries).queryKey).not.toEqual(key);
  expect(okfOverviewQueryOptions({ ...connection, baseUrl: "http://other" },scope,"2026-10-17",queries).queryKey).not.toEqual(key);
  expect(okfOverviewQueryOptions(connection,scope,"2026-10-18",queries).queryKey).not.toEqual(key);
  queries.clear();
});

test("failed_empty_result_still_shows_selected_scope_partial_banner_and_source_times", async () => {
  const queries = new QueryClient();
  const scope = okfScope([a],a,"/practice")!;
  const connection = { client: emptyServer, baseUrl: "http://synthetic", token: "synthetic" };
  const data = await queries.fetchQuery(okfOverviewQueryOptions(connection,scope,"2026-10-17",queries));
  const stale = { ...data, coverage: { ...data.coverage, status: "partial" as const, sources: data.coverage.sources.map(s => ({ ...s, state: "stale" as const, lastSuccessAt: 100, checkedAt: 200 })) } };
  const html = renderToStaticMarkup(<MemoryRouter><OkfPageState connection="ready" workspace="A" error={null} loading={false} data={stale} scope={scope} excludedWorkspaceIds={["outside"]}>{() => <span>content</span>}</OkfPageState></MemoryRouter>);
  expect(html).toContain('data-lawoss-practice-coverage="partial"');
  expect(html).toContain("/practice");
  expect(html).toContain('role="alert"');
  const failedRefresh = renderToStaticMarkup(<PracticeCoverage data={data} scope={scope} failed />);
  expect(failedRefresh).toContain('data-lawoss-practice-coverage="partial"');
  queries.clear();
});


test("profile_failure_does_not_fallback_to_active_client", () => {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const connection = { client: createLegalworkServerClient({ baseUrl: "http://synthetic", token: "synthetic" }), baseUrl: "http://synthetic", token: "synthetic", workspaces: [a,b], activeWorkspaceId: "A" };
  const key = ["okf-practice-root", connection.baseUrl, connection.token, 0];
  queries.getQueryCache().build(queries, { queryKey: key }).setState({ status: "error", error: new Error("profile unavailable") });
  function Probe() {
    const resolution = useOkfScope(connection,a);
    expect(resolution.state).toBe("unavailable");
    expect(resolution.scope).toBeNull();
    return null;
  }
  renderToStaticMarkup(<QueryClientProvider client={queries}><Probe /></QueryClientProvider>);
  queries.clear();
});


test("midnight refresh preserves last success in the same connection", async () => {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let fail = false;
  const client: OkfScopeClient = { ...emptyServer, listWorkspaceDirectory: async (...args) => {
    if (fail) throw new Error("unavailable");
    return emptyServer.listWorkspaceDirectory(...args);
  } };
  const connection = { client, baseUrl: "http://synthetic", token: "synthetic", authGeneration: 1 };
  const scope = okfScope([a],a,"/practice")!;
  await queries.fetchQuery(okfOverviewQueryOptions(connection,scope,"2026-10-17",queries));
  fail = true;
  const next = await queries.fetchQuery(okfOverviewQueryOptions(connection,scope,"2026-10-18",queries));
  expect(next.coverage.sources.find(s => s.workspaceId === "A")?.state).toBe("stale");
  const differentServer = await queries.fetchQuery(okfOverviewQueryOptions({ ...connection, baseUrl: "http://other" },scope,"2026-10-18",queries));
  expect(differentServer.coverage.sources.find(s => s.workspaceId === "A")?.state).toBe("unavailable");
  queries.clear();
});
