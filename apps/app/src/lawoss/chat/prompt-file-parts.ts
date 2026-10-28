import type { FilePartInput } from "@opencode-ai/sdk/v2/client";
import { firstLineLocalFileParts } from "@/react-app/domains/session/sync/prompt-file-parts";
import { comparable, isWithinClientFolder } from "../shell/session-directory";

/**
 * N-A7-13 (test 28. 10. 2026): cesta v prvom riadku správy sa stane prílohou len vtedy, keď leží
 * v priečinku klienta chatu. Ostatné cesty ostanú obyčajným textom a agent k nim ide cez svoje
 * nástroje, ktoré pri priečinku mimo klienta ukážu kartu.
 *
 * - Porovnanie robí `isWithinClientFolder`: NFC, `/` aj `\`, bez koncovej lomky, celé segmenty
 *   (`…/C001` nepustí `…/C001-2`), segment `..` nikdy nie je vnútri, veľkosť písmen podľa
 *   platformy (macOS a Windows bez rozdielu). `/C:/…` z `file:///C:/…` sa porovná ako `C:/…`.
 * - Najhlbší registrovaný priečinok nad cestou musí byť koreň klienta chatu. Keď koreň chatu
 *   obsahuje iný registrovaný priečinok (prax s klientmi alebo klient s vnoreným klientom), nevie sa
 *   ani pri jeho vlastných súboroch rozlíšiť prax od klienta, preto sa nepripojí nič. Inak je
 *   najhlbším registrovaným priečinkom nad každou cestou v koreni chatu práve tento koreň.
 * - Cesta, ktorá po dekódovaní stále obsahuje `%2e`, `%2f` alebo `%5c`, sa nepripojí.
 * - `~/` upstream rozvinie podľa koreňa; výsledok sa pripojí, len ak spĺňa všetko vyššie.
 * - Bez koreňa klienta sa nepripojí nič.
 */
export type ClientPathScope = { root: string; registeredRoots?: readonly string[] };

const DRIVE_WITH_SLASH = /^\/([A-Za-z]:\/)/;
const ENCODED_SEPARATOR_OR_DOT = /%(?:2e|2f|5c)/i;

/** Koreň klienta chatu (registrovaný priečinok projektu) a koreň každého registrovaného priečinka. */
export function clientPathScope(workspaces: readonly { id: string; path?: string | null }[], projectId: string, fallbackRoot: string): ClientPathScope {
  const root = workspaces.find((workspace) => workspace.id === projectId)?.path?.trim() || fallbackRoot;
  return { root, registeredRoots: workspaces.map((workspace) => workspace.path?.trim() ?? "").filter(Boolean) };
}

function inClientFolder(path: string, root: string): boolean {
  if (ENCODED_SEPARATOR_OR_DOT.test(path)) return false;
  return isWithinClientFolder(root, path.replace(DRIVE_WITH_SLASH, "$1"));
}

export function clientFirstLineFileParts(text: string, workspaceRoot: string, client: ClientPathScope = { root: workspaceRoot }): FilePartInput[] {
  const root = client.root.trim();
  if (!root) return [];
  const own = comparable(root);
  const registered = client.registeredRoots ?? [];
  if (registered.some((other) => comparable(other) !== own && isWithinClientFolder(root, other))) return [];
  return firstLineLocalFileParts(text, workspaceRoot, (path) => inClientFolder(path, root)).map((part) => ({
    ...part,
    // Upstream z `/C:/…` urobí `file:///C%3A/…`; zápis disku ako pri `C:\…`.
    url: part.url.replace(/^file:\/\/\/([A-Za-z])%3A\//, "file:///$1:/"),
  }));
}
