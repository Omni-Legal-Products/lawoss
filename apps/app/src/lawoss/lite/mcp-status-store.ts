/**
 * Posledná mapa stavov MCP vybraného priečinka, ako ju už číta stavový riadok appky (`useMcpConnectedCount`,
 * raz za minútu). Riadok registrov v bočnom paneli ju len zobrazí: žiadne ďalšie čítanie MCP, ktoré by engine
 * prebudilo (rozpočet RAM, `engine-mcp-budget.ts`).
 */
import { useSyncExternalStore } from "react";
import type { McpStatusMap } from "@/app/types";

let current: McpStatusMap | null = null;
const listeners = new Set<() => void>();

/** `null`: priečinok nie je vybraný alebo čítanie zlyhalo (stav registrov je neznámy). */
export function publishMcpStatuses(next: McpStatusMap | null): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useMcpStatuses(): McpStatusMap | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
