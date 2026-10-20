import { useSyncExternalStore } from "react";
import type { AiBoundaries } from "@legalwork/types/ai-governance";

/** Last known „AI hranice" state shared by the Settings row and the AI notice, so a toggle
 * updates every mounted notice immediately. Server state stays authoritative. */
let current: AiBoundaries | null = null;
const listeners = new Set<() => void>();

export function publishAiBoundaries(next: AiBoundaries | null | undefined) {
  if (!next || (current && current.enforced === next.enforced && current.locked === next.locked && current.source === next.source)) return;
  current = next;
  for (const listener of listeners) listener();
}

export function useAiBoundaries(): AiBoundaries | null {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
    () => current,
  );
}
