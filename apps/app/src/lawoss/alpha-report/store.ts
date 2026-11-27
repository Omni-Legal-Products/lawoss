/**
 * LAWOSS: otvorenie okna hlásenia. Hlavný proces najprv odfotí aktuálne okno (ešte bez dialógu), potom sa okno
 * zobrazí v `AlphaReportHost` (`shell/providers.tsx`). Mimo desktopu alebo bez hostiteľa ostáva webový formulár.
 */
import type { DesktopCommandResult } from "@legalwork/types/desktop-ipc";

export type AlphaReportSession = DesktopCommandResult<"lawossAlphaReportPrepare">;
/** Udalosť z menu Pomocník (preload ju prepošle z hlavného procesu). */
export const ALPHA_REPORT_OPEN_EVENT = "lawoss:alpha-report:open";

let session: AlphaReportSession | null = null;
let opening = false;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const alphaReportStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  snapshot: (): AlphaReportSession | null => session,
  attachHost() {
    hosts += 1;
    return () => {
      hosts -= 1;
      if (!hosts) session = null;
    };
  },
};

export type OpenAlphaReportDeps = {
  desktop: boolean;
  prepare: () => Promise<AlphaReportSession>;
  openWeb: () => Promise<unknown>;
};

/** `window`: okno v appke; `web`: webový formulár; `failed`: nepodarilo sa ani jedno. */
export async function openAlphaReport(deps: OpenAlphaReportDeps): Promise<"window" | "web" | "failed" | "busy"> {
  if (session || opening) return "busy";
  if (!deps.desktop || !hosts) {
    try { await deps.openWeb(); return "web"; } catch { return "failed"; }
  }
  opening = true;
  try {
    session = await deps.prepare();
    emit();
    return "window";
  } catch {
    try { await deps.openWeb(); return "web"; } catch { return "failed"; }
  } finally {
    opening = false;
  }
}

/** Zatvorí okno; hlavný proces zahodí snímku a diagnostiku. */
export function closeAlphaReport(discard: (id: number) => Promise<unknown>): void {
  const current = session;
  session = null;
  emit();
  if (current) void discard(current.id).catch(() => undefined);
}
