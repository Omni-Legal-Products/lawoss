import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import * as queries from "../src/react-app/infra/query-client";

test("a late sessions poke refreshes the active snapshot and marks inactive snapshots stale", async () => {
  const client = new QueryClient();
  let knownError = false;
  let reads = 0;
  const active = new QueryObserver(client, { queryKey: ["react-session-snapshot", "workspace", "session"], staleTime: Infinity,
    queryFn: async () => { reads += 1; return { knownError }; } });
  const stop = active.subscribe(() => {});
  try {
    await active.refetch();
    client.setQueryData(["react-session-snapshot", "other", "session"], { knownError: false });
    client.setQueryData(["unrelated"], "unchanged");
    const refresh = Reflect.get(queries, "refreshSessionSnapshotsOnSync");
    expect(refresh).toBeTypeOf("function");
    knownError = true;
    await refresh(client, { sessions: true });
    expect(active.getCurrentResult().data).toEqual({ knownError: true });
    expect(reads).toBe(2);
    expect(client.getQueryState(["react-session-snapshot", "other", "session"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["unrelated"])?.isInvalidated).toBe(false);
    await refresh(client, { tasks: true });
    expect(reads).toBe(2);
  } finally { stop(); client.clear(); }
});
