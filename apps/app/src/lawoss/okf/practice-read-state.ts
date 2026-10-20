import type { OkfSourceReadState } from "./read-model";

/** A failed attempt cannot advance the timestamp of the retained successful content. */
export function selectSourceSnapshot<T>(options: {
  current: T; previous?: T; previousState?: OkfSourceReadState;
  source: "workspace" | "office"; workspaceId?: string;
  checkedAt: number; valid: boolean; truncated: boolean;
}): { snapshot: T; retain: boolean; state: OkfSourceReadState } {
  const { valid, previous, previousState, current, checkedAt, source, workspaceId, truncated } = options;
  return {
    snapshot: valid ? current : previous ?? current,
    retain: valid || previous !== undefined,
    state: {
      source, ...(workspaceId === undefined ? {} : { workspaceId }), checkedAt,
      lastSuccessAt: valid ? checkedAt : previousState?.lastSuccessAt ?? null,
      state: valid ? "fresh" : previous !== undefined ? "stale" : truncated ? "truncated" : "unavailable",
    },
  };
}
