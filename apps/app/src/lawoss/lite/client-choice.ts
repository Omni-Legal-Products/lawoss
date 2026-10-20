/**
 * Krátky výber klienta pre „Nová vec“ a „Opýtať sa“ z prehľadu praxe (podklad PR #162).
 * Prehľad ukazuje všetkých klientov, konverzácia a nová vec však patria jednému klientovi: agent
 * vidí vždy len priečinok vybraného klienta. Z karty klienta alebo veci sa ide rovno do jej klienta.
 */
import { lastSegment } from "../../../../../lawoss/okf/read";
import { okfScopeKey, type OkfClient, type OkfScope } from "../okf/read-model";
import { NEW_MATTER_PATH } from "./links";

export type ClientChoice = { id: string; root: string; title: string };

/** Rovnaká relatívna cesta bez ohľadu na tvar diakritiky (NFC/NFD). */
const samePath = (a: string, b: string): boolean => a.normalize("NFC") === b.normalize("NFC");

/** Klienti praxe na výber; mimo praxe (jeden priečinok) prázdny zoznam, výber sa nepýta. */
export function practiceClientChoices(scope: OkfScope | null, clients: readonly OkfClient[] = []): ClientChoice[] {
  if (!scope?.practiceRoot) return [];
  return scope.members
    .map(({ workspace, prefix }) => ({
      id: workspace.id,
      root: workspace.path,
      title: clients.find((c) => samePath(c.path, prefix))?.title || workspace.displayNameResolved || workspace.name || lastSegment(prefix),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "cs") || a.id.localeCompare(b.id));
}

const LAST_CLIENT_KEY = "lawoss.lastClient.v2";
export const clientPreferenceScope = (scope: OkfScope | null, server = ""): string => scope ? JSON.stringify([server, okfScopeKey(scope)]) : "";

/** Posledný vybraný klient na tomto zariadení; nečitateľné úložiště = žiadny. */
export function readLastClient(scopeKey: string): string | null {
  try { return globalThis.localStorage?.getItem(`${LAST_CLIENT_KEY}:${scopeKey}`) ?? null; } catch { return null; }
}

export function rememberClient(scopeKey: string, id: string): void {
  try { globalThis.localStorage?.setItem(`${LAST_CLIENT_KEY}:${scopeKey}`, id); } catch { /* pohodlie, nie stav */ }
}

/** Predvolený klient: naposledy vybraný, inak práve otvorený, inak prvý v zozname. */
export function defaultClientChoice(choices: readonly ClientChoice[], activeId?: string | null, lastId: string | null = null): ClientChoice | undefined {
  return choices.find((c) => c.id === lastId) ?? choices.find((c) => c.id === activeId) ?? choices[0];
}

/** Formulár novej veci rovno pre klienta (`root` odovzdá `welcome-route` ako `initialRoot`). */
export const newMatterLink = (clientRoot?: string): string => clientRoot ? `${NEW_MATTER_PATH}&root=${encodeURIComponent(clientRoot)}` : NEW_MATTER_PATH;

/** Klient z karty v prehľade (cesta voči koreňu praxe) → jeho priečinok, ak je to registrovaný klient. */
export function clientRootOf(scope: OkfScope | null, clientPath: string): string | undefined {
  if (!scope?.practiceRoot) return undefined;
  return scope.members.find((m) => samePath(m.prefix, clientPath))?.workspace.path;
}
