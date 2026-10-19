/**
 * Krátky výber klienta pre „Nová vec“ a „Opýtať sa“ z prehľadu praxe (rozhodnutie MČ 16. 10. 2026).
 * Prehľad ukazuje všetkých klientov, konverzácia a nová vec však patria jednému klientovi: agent
 * vidí vždy len priečinok vybraného klienta. Z karty klienta alebo veci sa ide rovno do jej klienta.
 */
import { lastSegment } from "../../../../../lawoss/okf/read";
import type { OkfClient, OkfScope } from "../okf/read-model";
import { NEW_MATTER_PATH } from "./links";

export type ClientChoice = { id: string; root: string; title: string };

/** Klienti praxe na výber; mimo praxe (jeden priečinok) prázdny zoznam, výber sa nepýta. */
export function practiceClientChoices(scope: OkfScope | null, clients: readonly OkfClient[] = []): ClientChoice[] {
  if (!scope?.practiceRoot) return [];
  return scope.members
    .map(({ workspace, prefix }) => ({
      id: workspace.id,
      root: workspace.path,
      title: clients.find((c) => c.path === prefix)?.title || workspace.displayNameResolved || workspace.name || lastSegment(prefix),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "cs") || a.id.localeCompare(b.id));
}

const LAST_CLIENT_KEY = "lawoss.lastClient";

/** Posledný vybraný klient na tomto zariadení; nečitateľné úložiště = žiadny. */
export function readLastClient(): string | null {
  try { return globalThis.localStorage?.getItem(LAST_CLIENT_KEY) ?? null; } catch { return null; }
}

export function rememberClient(id: string): void {
  try { globalThis.localStorage?.setItem(LAST_CLIENT_KEY, id); } catch { /* pohodlie, nie stav */ }
}

/** Predvolený klient: naposledy vybraný, inak práve otvorený, inak prvý v zozname. */
export function defaultClientChoice(choices: readonly ClientChoice[], activeId?: string | null, lastId: string | null = readLastClient()): ClientChoice | undefined {
  return choices.find((c) => c.id === lastId) ?? choices.find((c) => c.id === activeId) ?? choices[0];
}

/** Formulár novej veci rovno pre klienta (`root` odovzdá `welcome-route` ako `initialRoot`). */
export const newMatterLink = (clientRoot?: string): string => clientRoot ? `${NEW_MATTER_PATH}&root=${encodeURIComponent(clientRoot)}` : NEW_MATTER_PATH;

/**
 * Klient z karty v prehľade (cesta voči koreňu praxe) → jeho priečinok, ak je to registrovaný klient.
 * Mimo praxe je klient podpriečinkom otvoreného priečinka (`Klienti/ACME` v kancelárii, test 19. 10. 2026);
 * klient, ktorý je celým otvoreným priečinkom (`""`), ostáva na otvorenom klientovi formulára.
 */
export function clientRootOf(scope: OkfScope | null, clientPath: string): string | undefined {
  if (!scope) return undefined;
  if (scope.practiceRoot) return scope.members.find((m) => m.prefix === clientPath)?.workspace.path;
  if (!clientPath) return undefined;
  const base = scope.anchor.path.replace(/[\\/]+$/, "");
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return [base, ...clientPath.split("/").filter(Boolean)].join(separator);
}
