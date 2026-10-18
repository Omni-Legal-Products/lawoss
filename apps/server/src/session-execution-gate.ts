import { ApiError } from "./errors.js";
import type { ServerConfig } from "./types.js";

type Gate = { sends: Map<string, number>; deleting: Map<string, Promise<void>> };
const gates = new WeakMap<ServerConfig, Gate>();
function gate(config: ServerConfig): Gate {
  let value = gates.get(config);
  if (!value) { value = { sends: new Map(), deleting: new Map() }; gates.set(config, value); }
  return value;
}
const busy = () => new ApiError(409, "session_busy", "This chat is sending or being checked for deletion. Wait for it to finish before trying again.");

/** Reserve before preparation/dispatch, including asynchronous command delivery. */
export async function withSessionExecution<T>(config: ServerConfig, sessionId: string, run: () => Promise<T>, waitForDeletion = false): Promise<T> {
  const state = gate(config);
  while (state.deleting.has(sessionId)) {
    if (!waitForDeletion) throw busy();
    await state.deleting.get(sessionId)!;
  }
  state.sends.set(sessionId, (state.sends.get(sessionId) ?? 0) + 1);
  try { return await run(); }
  finally {
    const remaining = state.sends.get(sessionId)! - 1;
    if (remaining) state.sends.set(sessionId, remaining); else state.sends.delete(sessionId);
  }
}

/** Lock each discovered descendant before its idle check and final snapshot. */
export function beginSessionDeletion(config: ServerConfig, sessionId: string): () => void {
  const state = gate(config);
  if (state.deleting.has(sessionId) || state.sends.has(sessionId)) throw busy();
  let release = () => {};
  const done = new Promise<void>(resolve => { release = resolve; });
  state.deleting.set(sessionId, done);
  return () => { state.deleting.delete(sessionId); release(); };
}
