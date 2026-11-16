/**
 * LAWOSS #460: kedy sa prehľad OKF číta znova. Každé čítanie prejde strom všetkých klientov praxe (pri 24 klientoch
 * ~400 výpisov priečinkov), preto sa pri nečinnosti nečíta každých 15 s, ale:
 *
 * - po zápise agenta v chate: nástroj, ktorý mení súbory (najviac raz za `OKF_AGENT_WRITE_MIN_INTERVAL_MS`, rozbehnuté
 *   čítanie sa nepreruší), a hneď na konci ťahu (`session-sync.ts` pre chaty zobrazeného klienta, `session-route.tsx`
 *   pre chat ktoréhokoľvek klienta, ktorý prestal bežať),
 * - pri návrate do okna (`focus`, najviac raz za `OKF_FOCUS_REVALIDATE_MS`) a pri zobrazení okna (react-query
 *   `refetchOnWindowFocus` počúva len `visibilitychange`),
 * - pri otvorení stránky, ktorá prehľad používa (react-query `refetchOnMount`), a po zmene nastavení servera,
 * - inak najviac raz za `OKF_IDLE_REFRESH_MS` (zmeny mimo appky, napr. Finder alebo synchronizácia disku).
 *
 * Obnova len označí dopyty `okf-overview` za neaktuálne (`invalidateQueries`); kľúč ani posledný prehľad (#418) sa
 * nemenia a číta sa len dopyt, ktorý niekto zobrazuje.
 */
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

/** Tichá obnova pri nečinnosti: zmeny mimo appky (Finder, synchronizácia disku). */
export const OKF_IDLE_REFRESH_MS = 5 * 60_000;
/** Strop pre veľkú kanceláriu, keď čítanie trvá dlho (desaťnásobok čítania). */
export const OKF_IDLE_REFRESH_MAX_MS = 15 * 60_000;
/** Zápisy agenta tesne po sebe (zápis pamäte, potom registra) vyvolajú jedno čítanie. */
export const OKF_AGENT_WRITE_SETTLE_MS = 1_500;
/** Počas ťahu s mnohými príkazmi najviac jedno čítanie praxe za tento čas; koniec ťahu číta hneď. */
export const OKF_AGENT_WRITE_MIN_INTERVAL_MS = 15_000;
/** Prepínanie okien tam a späť nečíta prax zakaždým. */
export const OKF_FOCUS_REVALIDATE_MS = 30_000;

/**
 * Nástroje chatu, ktoré môžu zmeniť súbory v praxi: nástroje LAWOSS so zápisom (kategórie `write`, `edit`, `command`
 * v `lawoss/chat/tool-labels.ts`), nový klient a zapisujúce nástroje enginu. Čítanie dokumentov a zdroje nie.
 */
const WRITING_TOOLS = new Set([
  "lawoss_files", "lawoss_memory_write", "lawoss_memory_deadline", "lawoss_documents_export", "lawoss_new_client", "legalwork_shell",
  "write", "edit", "multiedit", "patch", "apply_patch", "bash",
]);
export const writesPracticeFiles = (tool: string): boolean => WRITING_TOOLS.has(tool);

const OVERVIEW = { queryKey: ["okf-overview"] } as const;
const pending = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>();
const focusedAt = new WeakMap<QueryClient, number>();
const toolReadAt = new WeakMap<QueryClient, number>();

function revalidate(queries: QueryClient): void {
  const timer = pending.get(queries);
  if (timer !== undefined) clearTimeout(timer);
  pending.delete(queries);
  void queries.invalidateQueries(OVERVIEW);
}

/**
 * Nástroj chatu skončil úspešne: po zapisujúcom nástroji sa prehľad o chvíľu prečíta. Naplánované čítanie sa
 * neodkladá, za `minIntervalMs` je najviac jedno a rozbehnuté čítanie sa nepreruší (`cancelRefetch: false`), takže
 * aj na pomalom disku dobehne; čo zmeškalo, prečíta koniec ťahu.
 */
export function revalidateOkfAfterAgentTool(queries: QueryClient, tool: string,
  options: { settleMs?: number; minIntervalMs?: number; now?: () => number } = {}): void {
  if (!writesPracticeFiles(tool) || pending.has(queries)) return;
  const now = options.now ?? Date.now, last = toolReadAt.get(queries);
  const wait = Math.max(options.settleMs ?? OKF_AGENT_WRITE_SETTLE_MS, last === undefined ? 0 : last + (options.minIntervalMs ?? OKF_AGENT_WRITE_MIN_INTERVAL_MS) - now());
  pending.set(queries, setTimeout(() => {
    pending.delete(queries);
    toolReadAt.set(queries, now());
    void queries.invalidateQueries(OVERVIEW, { cancelRefetch: false });
  }, wait));
}

/** Ťah agenta skončil (aj zlyhaním alebo zastavením): súbory sa mohli zmeniť aj príkazom, prehľad sa prečíta hneď. */
export function revalidateOkfAfterAgentTurn(queries: QueryClient): void {
  revalidate(queries);
}

/**
 * Chat ktoréhokoľvek klienta prestal bežať (zoznam chatov v trase, aj keď jeho klient nie je zobrazený a jeho udalosti
 * appka nesleduje): prehľad sa prečíta ako po konci ťahu. `active` sú id bežiacich chatov.
 */
export function useOkfRevalidateOnFinishedChats(active: readonly string[]): void {
  const queries = useQueryClient();
  const previous = useRef<readonly string[]>([]);
  useEffect(() => {
    if (chatsFinished(previous.current, active)) revalidateOkfAfterAgentTurn(queries);
    previous.current = active;
  }, [active, queries]);
}

/** Niektorý chat, ktorý predtým bežal, už nebeží. */
export function chatsFinished(before: readonly string[], now: readonly string[]): boolean {
  const running = new Set(now);
  return before.some(id => !running.has(id));
}

/** Návrat do okna: prehľad sa prečíta, ak sa naposledy pri návrate nečítal pred menej než `minimumMs`. */
export function revalidateOkfOnFocus(queries: QueryClient, now = Date.now(), minimumMs = OKF_FOCUS_REVALIDATE_MS): boolean {
  const last = focusedAt.get(queries);
  if (last !== undefined && now - last < minimumMs) return false;
  focusedAt.set(queries, now);
  revalidate(queries);
  return true;
}

/** Jeden poslucháč `focus` okna na každé použitie prehľadu; obnovu obmedzuje spoločný čas posledného návratu. */
export function listenOkfFocus(queries: QueryClient): () => void {
  if (typeof window === "undefined") return () => {};
  const onFocus = () => { revalidateOkfOnFocus(queries); };
  window.addEventListener("focus", onFocus);
  return () => window.removeEventListener("focus", onFocus);
}

/** Pri nečinnosti `OKF_IDLE_REFRESH_MS`, alebo desaťnásobok posledného čítania, najviac `OKF_IDLE_REFRESH_MAX_MS`. */
export function okfIdleRefreshInterval(lastReadMs: number | undefined): number {
  return Math.min(OKF_IDLE_REFRESH_MAX_MS, Math.max(OKF_IDLE_REFRESH_MS, Math.round((lastReadMs ?? 0) * 10)));
}
