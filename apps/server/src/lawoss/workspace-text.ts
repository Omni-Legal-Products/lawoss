import { readFile } from "node:fs/promises";
import { basename } from "node:path";

/**
 * Text z Windows: Poznámkový blok a PowerShell 5.1 ukladajú „UTF-8 s BOM“ alebo UTF-16 s BOM
 * (`Out-File`, presmerovanie `>`). Rovnaké pravidlo ako `decodeText` v
 * `lawoss/okf-pamat/src/text-decode.ts` (server má `rootDir` src, preto kópia): UTF-16 LE aj BE
 * len podľa BOM, inak UTF-8; úvodný BOM sa odstráni, neplatné bajty sú U+FFFD.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Uint8Array.from(bytes);
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      swapped[i] = bytes[i + 1]!;
      swapped[i + 1] = bytes[i]!;
    }
    return new TextDecoder("utf-16le").decode(swapped);
  }
  return new TextDecoder(bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : "utf-8").decode(bytes);
}

/**
 * Text súboru workspace-u pre editor appky. `okf.config` sa číta ako v CLI OKF, aby appka
 * (Nový spis, nastavenia kancelárie, `client_path`) a agent videli ten istý profil; ostatné
 * súbory ostávajú UTF-8 ako v upstreame. Uloženie cez editor zapíše UTF-8 bez BOM.
 */
export async function readWorkspaceText(path: string): Promise<string> {
  return basename(path) === "okf.config" ? decodeText(await readFile(path)) : readFile(path, "utf8");
}
