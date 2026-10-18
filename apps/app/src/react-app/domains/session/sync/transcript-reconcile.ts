import type { UIMessage } from "ai";
import type { LegalworkSessionSnapshot } from "../../../../app/lib/legalwork-server";

import { SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX } from "../../../../app/types";
import { mergeSnapshotIntoCachedMessages } from "./message-merge";

export type TranscriptReconcileReason = "snapshot" | "revert";

export type ReconcileTranscriptInput = {
  /** Current canonical transcript cache rendered by the session UI. */
  currentMessages: UIMessage[];
  /** Messages reconstructed from the latest server snapshot. */
  snapshotMessages: UIMessage[];
  /** Why this reconciliation is happening. Reserved for explicit truncation rules. */
  reason?: TranscriptReconcileReason;
};

/**
 * Reconcile a server snapshot into the canonical transcript cache.
 *
 * Snapshot reads can lag behind the OpenCode event stream during prompt
 * submission. This helper centralizes the invariant that ordinary snapshots
 * may fill/update the cache, but must not make the visible transcript move
 * backwards. Explicit history operations such as revert can opt into their own
 * truncation path instead of relying on snapshot absence.
 */
export function reconcileTranscriptMessages(input: ReconcileTranscriptInput): UIMessage[] {
  const current = input.currentMessages;
  const snapshot = input.snapshotMessages;

  if (current.length === 0) return snapshot;
  if (snapshot.length === 0) return current;

  return mergeSnapshotIntoCachedMessages(snapshot, current);
}

/**
 * Hide messages at and after OpenCode's revert cursor. Revert is an explicit
 * history mutation, so it is the one place the rendered transcript is allowed
 * to move backwards.
 *
 * OpenCode treats `session.revert.messageID` as the FIRST reverted message
 * (every message with `id >= revert.messageID` is reverted), so the cursor
 * message itself must be hidden too.
 */
export function applyRevertCursor(messages: UIMessage[], revertMessageId: string | null | undefined): UIMessage[] {
  if (!revertMessageId || messages.length === 0) return messages;
  const idx = messages.findIndex((message) => message.id === revertMessageId);
  if (idx < 0) return messages;
  return messages.slice(0, idx);
}

/** Resolve only aliases proved by this raw snapshot, then respect a known live boundary. */
export function applySnapshotRevertCursor(
  messages: UIMessage[],
  snapshot: LegalworkSessionSnapshot | null | undefined,
  incoming: UIMessage[],
  existing: UIMessage[],
): UIMessage[] {
  const rawId = snapshot?.session.revert?.messageID;
  if (!rawId) return messages;
  let boundary = rawId;
  if (!incoming.some((message) => message.id === rawId)) {
    const raw = snapshot.messages.find((message) => message.info.id === rawId);
    const errorId = `${SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX}${rawId}`;
    if (raw?.info.role === "assistant" && raw.info.error && incoming.some((message) => message.id === errorId)) {
      boundary = errorId;
    }
  }
  // A partial page cannot prove a cut. Keep the already known live history;
  // merging the unbounded page here could resurrect a previously reverted tail.
  if (!incoming.some((message) => message.id === boundary) && !existing.some((message) => message.id === boundary)) return existing;
  // A live raw assistant can coexist with its converted error row. Both
  // identify this proved raw boundary; hide whichever occurs first in the merge.
  const firstBoundary = messages.find((message) => message.id === rawId || message.id === boundary);
  return applyRevertCursor(messages, firstBoundary?.id ?? boundary);
}

function isSyntheticMessageId(id: string) {
  return id.startsWith(SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX);
}

/**
 * Resolve the message id to pass to OpenCode's `session.fork` so the branch
 * INCLUDES the message the user branched at.
 *
 * OpenCode copies messages strictly BEFORE the given id, so branching "at" a
 * message means forking at the next real message after it. Synthetic
 * client-side messages (e.g. `session-error:*`) are skipped because their ids
 * do not exist server-side and would corrupt the fork boundary. Returns null
 * when the branch point is the last message, meaning "fork the full session".
 */
export function resolveForkBoundaryId(messages: UIMessage[], messageId: string): string | null {
  const idx = messages.findIndex((message) => message.id === messageId);
  if (idx < 0) return null;
  for (let index = idx + 1; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (candidate && !isSyntheticMessageId(candidate.id)) return candidate.id;
  }
  return null;
}
