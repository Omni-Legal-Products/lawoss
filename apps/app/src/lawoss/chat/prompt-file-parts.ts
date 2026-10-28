import type { FilePartInput } from "@opencode-ai/sdk/v2/client";
import { firstLineLocalFileParts } from "@/react-app/domains/session/sync/prompt-file-parts";
import { isWithinClientFolder } from "../shell/session-directory";

/**
 * N-A7-13 (test 28. 10. 2026): cesta v prvom riadku správy sa stane prílohou len vtedy, keď leží
 * v priečinku klienta (koreň klienta alebo priečinok pod ním). Ostatné cesty ostanú obyčajným textom
 * a agent k nim ide cez svoje nástroje, ktoré pri priečinku mimo klienta ukážu kartu.
 *
 * Porovnanie robí `isWithinClientFolder`: NFC, `/` aj `\`, bez koncovej lomky, celé segmenty
 * (`…/C001` nepustí `…/C001-2`), segment `..` nikdy nie je vnútri, veľkosť písmen podľa platformy
 * (macOS a Windows bez rozdielu). `~/` upstream rozvinie podľa koreňa; výsledok sa pripojí, len ak
 * leží v priečinku klienta. Bez koreňa klienta sa nepripojí nič.
 */
export function clientFirstLineFileParts(text: string, workspaceRoot: string, clientRoot = workspaceRoot): FilePartInput[] {
  const root = clientRoot.trim();
  if (!root) return [];
  return firstLineLocalFileParts(text, workspaceRoot, (path) => isWithinClientFolder(root, path));
}
