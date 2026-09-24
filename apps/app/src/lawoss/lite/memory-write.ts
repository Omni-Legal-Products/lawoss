/**
 * Rozpozná návrh zápisu do paměti věci (`okf-memory write …`) v příkazu bash
 * permission requestu, aby se v lite zobrazila srozumitelná karta místo
 * syrového shellu. Vrací proposal jen když je celý příkaz PŘESNĚ jedno
 * volání `[node|bun] <cesta k okf-memory> write <spis> [--file …]
 * [--reason …] [--apply] [--approve-as …]` — nic jiného vedle toho.
 * Cokoli jiné vrací `null` (karta se nezobrazí, panel beze změny):
 * zmínka v jiném příkazu, jiný podpříkaz, chybějící spis (Review Focus 5);
 * jakýkoli znak mimo doslovný výčet (operátory, expanze, glob, složené závorky,
 * řídicí znaky vč. konce řádku) kdekoli v příkazu; opakovaný flag — schválený příkaz
 * by jinak dělal i něco jiného, než co karta popisuje; nerozpoznaný nebo
 * přebytečný token po vlajkách; vlajka vyžadující hodnotu bez ní. Uvozovky
 * dělají z metaznaků uvnitř data, ne operátor (`--reason "a; b"` je v
 * pořádku) — ale v `"…"` shell stále provádí `$`, zpětné apostrofy a `\`,
 * proto tam vedou na `null`; jen `'…'` je čistě literál. Vždy raději `null`
 * než hádat (fix round 1, final review C1).
 */

export type MemoryWriteProposal = {
  matterDir: string;
  file?: string;
  reason?: string;
  apply: boolean;
  approvedBy?: string;
};

/**
 * Povolené znaky neuvozovkovaného slova — výčet toho, co shell bere doslova
 * (písmena vč. diakritiky, číslice, `_ . / @ % + = , : -`). Cokoli jiného
 * (operátory, `$`, `\`, `~`, `#`, `!`, glob `* ? [ ]`, složené závorky
 * `{a,b}`, uvozovka uprostřed slova, nezlomitelná mezera) → `null`.
 * Výčet místo zákazu: zákaz vždy něco vynechá (review PR #100: `{x,--apply}`).
 */
const LITERAL_WORD = /^[\p{L}\p{M}\p{N}_./@%+=,:-]+$/u;
/** Řídicí znak kdekoli — i uvnitř uvozovek (konec řádku = druhý příkaz). */
const CONTROL_CHAR = /[\u0000-\u0008\u000a-\u001f\u007f]/;
const SEPARATOR = /[ \t]/;

/**
 * Rozdělí příkaz na tokeny jako shell — nebo vrátí `null`, kdykoli by se
 * výklad shellu mohl lišit od karty. `'…'` je literál; `"…"` jen bez `$`,
 * zpětných apostrofů a `\`; po uzavírací uvozovce musí následovat oddělovač
 * (`"a"b` je pro shell jeden argument).
 */
function tokenize(command: string): string[] | null {
  if (CONTROL_CHAR.test(command)) return null;
  const tokens: string[] = [];
  let i = 0;
  while (i < command.length) {
    while (i < command.length && SEPARATOR.test(command[i]!)) i++;
    if (i >= command.length) break;
    const ch = command[i]!;
    if (ch === '"' || ch === "'") {
      const end = command.indexOf(ch, i + 1);
      if (end === -1) return null; // nevyvážené uvozovky — nikdy nehádat
      const body = command.slice(i + 1, end);
      if (ch === '"' && /[$`\\]/.test(body)) return null;
      i = end + 1;
      if (i < command.length && !SEPARATOR.test(command[i]!)) return null;
      tokens.push(body);
    } else {
      const start = i;
      while (i < command.length && !SEPARATOR.test(command[i]!)) i++;
      const word = command.slice(start, i);
      if (!LITERAL_WORD.test(word)) return null;
      tokens.push(word);
    }
  }
  return tokens;
}

/**
 * CLI skillu `okf-pamat`: holé `okf-memory` (z PATH), nebo `…/skills/okf-pamat/resources/okf-memory.js`
 * absolutně či `.opencode/skills/okf-pamat/…` relativně, bez `.`/`..` segmentů.
 * ponytail: shoda podle cesty, ne podle obsahu souboru — asistent se zápisem do složky skillu
 * by kartu dostal i pro podvržený skript; pevně to řeší jen předání kořene pracovní složky do karty.
 */
function isOkfMemoryBinary(token: string): boolean {
  if (token === "okf-memory") return true;
  if (token.split("/").some((part) => part === "." || part === "..")) return false;
  return /^\/(?:.+\/)?skills\/okf-pamat\/resources\/okf-memory\.js$/.test(token)
    || /^\.opencode\/skills\/okf-pamat\/resources\/okf-memory\.js$/.test(token);
}

export function describeMemoryWrite(command: string): MemoryWriteProposal | null {
  try {
    const tokens = tokenize(command);
    if (!tokens || tokens.length === 0) return null;

    let i = 0;
    if (tokens[i] === "node" || tokens[i] === "bun") i++;
    const bin = tokens[i];
    if (bin === undefined || !isOkfMemoryBinary(bin)) return null;
    i++;

    if (tokens[i] !== "write") return null;
    i++;

    const matterDir = tokens[i];
    if (!matterDir || matterDir.startsWith("--")) return null;
    i++;

    let file: string | undefined;
    let reason: string | undefined;
    let apply = false;
    let approvedBy: string | undefined;
    const seen = new Set<string>();
    for (; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok === "--apply") { apply = true; continue; }
      if (tok === "--file" || tok === "--reason" || tok === "--approve-as" || tok === "--if-revision") {
        const value = tokens[++i];
        if (value === undefined || value.startsWith("--")) return null; // flag bez hodnoty
        // Opakovaný flag: CLI bere první výskyt, karta by ukázala jiný — nikdy nehádat.
        if (seen.has(tok)) return null;
        seen.add(tok);
        if (tok === "--file") file = value;
        else if (tok === "--reason") reason = value;
        else if (tok === "--approve-as") approvedBy = value;
        // --if-revision: cíl úpravy, hodnota se jen spotřebuje, do karty nepatří
        continue;
      }
      return null; // neznámý/přebytečný token — příkaz dělá i něco jiného, nikdy nehádat
    }

    return { matterDir, file, reason, apply, approvedBy };
  } catch {
    return null;
  }
}
