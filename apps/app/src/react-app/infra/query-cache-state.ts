import { useCallback, useSyncExternalStore } from "react";
import { hashKey, notifyManager } from "@tanstack/react-query";

import { getReactQueryClient } from "./query-client";

/**
 * Subscribe to a TanStack Query cache entry as plain external state.
 * Pass a null key to pin the fallback (used while route params are missing).
 */
export function useQueryCacheState<T>(queryKey: readonly unknown[] | null, fallback: T): T {
  const queryClient = getReactQueryClient();
  const queryHash = queryKey ? hashKey(queryKey) : null;
  // Stable across renders and listening to this query only: a streaming update must not wake every other reader.
  const subscribe = useCallback((callback: () => void) => {
    if (queryHash === null) return () => {};
    const notify = notifyManager.batchCalls(callback);
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryHash === queryHash) notify();
    });
  }, [queryClient, queryHash]);
  return useSyncExternalStore(
    subscribe,
    () => (queryKey ? queryClient.getQueryData<T>(queryKey) ?? fallback : fallback),
    () => fallback,
  );
}
