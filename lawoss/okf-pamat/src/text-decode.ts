/**
 * Text, ktorý napísal človek alebo agent — nie tento nástroj.
 *
 * Windows PowerShell 5.1 a Poznámkový blok ukladajú „UTF-8 s BOM“
 * (`Set-Content -Encoding UTF8`) alebo UTF-16LE s BOM (`Out-File`,
 * presmerovanie `>`). Čítanie cez `readFileSync(…, "utf8")` z toho urobilo
 * U+FEFF pred prvým kľúčom, resp. text s nulovými znakmi, a parser
 * `okf.config` spadol hneď na prvom riadku.
 *
 * UTF-16 (LE aj BE) sa rozpozná iba podľa BOM; súbor bez BOM je UTF-8 ako
 * doteraz. Neplatné bajty sa nahradia U+FFFD rovnako ako pri
 * `readFileSync(…, "utf8")` — odmietnuť celý súbor kvôli jednému ANSI znaku
 * je na volajúcom, ktorý vie, ktorá hodnota sa naozaj použije. Bez `node:fs`,
 * aby to zdieľala aj appka.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    // UTF-16BE: prehodiť bajty v pároch a dekódovať ako LE. Nie každý Node má
    // dekodér „utf-16be“ (small-icu), „utf-16le“ áno.
    const swapped = Uint8Array.from(bytes);
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      swapped[i] = bytes[i + 1]!;
      swapped[i + 1] = bytes[i]!;
    }
    return new TextDecoder("utf-16le").decode(swapped);
  }
  // TextDecoder úvodný BOM sám odstráni — EF BB BF pri UTF-8 aj FF FE pri UTF-16LE.
  return new TextDecoder(bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : "utf-8").decode(bytes);
}

/** Úvodný U+FEFF z textu, ktorý už dekódoval niekto iný (`readFileSync`, server appky). */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
