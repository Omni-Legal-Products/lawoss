import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { okfRawFilesQueryOptions } from "../src/lawoss/okf/raw-files";
import { okfScope, type OkfReadClient } from "../src/lawoss/okf/read-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";
const workspace: RouteWorkspace = { id: "same", name: "Client", path: "/practice/A", workspaceType: "local" };
const scope = okfScope([workspace],workspace,"/practice")!;
const paths = ["A/memory/broken.md"];
const client: OkfReadClient = {
  listWorkspaceDirectory: async () => ({ entries: [], path: "", truncated: false }),
  readWorkspaceFile: async (_id,path) => ({ content: "current source", path, bytes: 14, updatedAt: 0 }),
};
const connection = { client, baseUrl: "http://synthetic-a", token: "synthetic-a", authGeneration: 1 };

test("raw source ownership changes with server auth root and member paths", () => {
  const original = okfRawFilesQueryOptions(connection,scope,paths).queryKey;
  for (const changed of [{ ...connection,baseUrl: "http://synthetic-b" },{ ...connection,token: "synthetic-b" },{ ...connection,authGeneration: 2 }])
    expect(okfRawFilesQueryOptions(changed,scope,paths).queryKey).not.toEqual(original);
  expect(okfRawFilesQueryOptions(connection,{ ...scope,practiceRoot: "/other" },paths).queryKey).not.toEqual(original);
  expect(okfRawFilesQueryOptions(connection,{ ...scope,members: [{ ...scope.members[0],workspace: { ...workspace,path: "/practice/Moved" } }] },paths).queryKey).not.toEqual(original);
  expect(okfRawFilesQueryOptions(connection,scope,["A/a|A/b"]).queryKey).not.toEqual(okfRawFilesQueryOptions(connection,scope,["A/a","A/b"]).queryKey);
});

test("held old raw read is cancelled and cannot appear after a server switch", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let enter!: () => void, release!: () => void, finished!: () => void;
  const admitted = new Promise<void>(resolve => { enter = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const completed = new Promise<void>(resolve => { finished = resolve; });
  let signal: AbortSignal | undefined;
  const old: OkfReadClient = { ...client,readWorkspaceFile: async (_id,path,options) => {
    signal = options?.signal; enter(); await blocked; finished();
    return { path,content: "OLD PRIVATE SOURCE",bytes: 18,updatedAt: 0 };
  } };
  const observer = new QueryObserver(cache,okfRawFilesQueryOptions({ ...connection,client: old },scope,paths));
  const observed: unknown[] = [];
  const stop = observer.subscribe(result => { if (result.data) observed.push(result.data); });
  try {
    await admitted;
    observer.setOptions(okfRawFilesQueryOptions({ ...connection,baseUrl: "http://synthetic-b" },scope,paths));
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(signal?.aborted).toBe(true);
    await observer.refetch();
    release(); await completed;
    expect(observer.getCurrentResult().data?.[paths[0]]).toBe("current source");
    expect(JSON.stringify(observed)).not.toContain("OLD PRIVATE SOURCE");
  } finally { release(); await completed; stop(); cache.clear(); }
});

test("a previously cached raw source is never displayed by a new auth owner", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const oldClient: OkfReadClient = { ...client, readWorkspaceFile: async (_id,path) => ({ path,content: "PREVIOUS OWNER",bytes: 14,updatedAt: 0 }) };
  await cache.fetchQuery(okfRawFilesQueryOptions({ ...connection,client: oldClient },scope,paths));
  const observer = new QueryObserver(cache,okfRawFilesQueryOptions({ ...connection,authGeneration: 2 },scope,paths));
  try {
    expect(observer.getCurrentResult().data).toBeUndefined();
    await observer.refetch();
    expect(observer.getCurrentResult().data?.[paths[0]]).toBe("current source");
  } finally { observer.destroy(); cache.clear(); }
});
