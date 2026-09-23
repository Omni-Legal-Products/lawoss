/**
 * Rozpozná návrh zápisu do paměti věci (`okf-memory write …`) v příkazu bash
 * permission requestu, aby se v lite zobrazila srozumitelná karta místo
 * syrového shellu. Vrací proposal jen když je celý příkaz PŘESNĚ jedno
 * volání `[node|bun] <cesta k okf-memory> write <spis> [--file …]
 * [--reason …] [--apply] [--approve-as …]` — nic jiného vedle toho.
 * Cokoli jiné vrací `null` (karta se nezobrazí, panel beze změny):
 * zmínka v jiném příkazu, jiný podpříkaz, chybějící spis (Review Focus 5);
 * jakýkoli neuvozovkovaný shell operátor (`;`, `&`, `|`, `<`, `>`, zpětné
 * apostrofy, `$(`, `${`, konec řádku) kdekoli v příkazu — schválený příkaz
 * by jinak dělal i něco jiného, než co karta popisuje; nerozpoznaný nebo
 * přebytečný token po vlajkách; vlajka vyžadující hodnotu bez ní. Uvozovky
 * dělají z metaznaků uvnitř data, ne operátor (`--reason "a; b"` je v
 * pořádku) — vždy raději `null` než hádat (fix round 1).
 */

export type MemoryWriteProposal = {
  matterDir: string;
  file?: string;
  reason?: string;
  apply: boolean;
  approvedBy?: string;
};

/** Neuvozovkovaný shell operátor/metaznak — příkaz dělá i něco jiného než navržený zápis. */
const UNQUOTED_METACHAR = /[;&|<>`\n\r]/;

/**
 * Rozdělí příkaz na tokeny; uvozovky `"…"`/`'…'` drží obsah pohromadě (uvnitř
 * uvozovek jsou metaznaky data, ne operátor — např. `--reason "a; b"` je v
 * pořádku). Neuvozovkovaný `;`, `&`, `|`, `<`, `>`, zpětné apostrofy, konec
 * řádku nebo `$(`/`${` znamenají, že příkaz dělá vedle zápisu i něco jiného
 * → `null`, karta se nezobrazí (nikdy nehádat, viz fix round 1).
 */
function tokenize(command: string): string[] | null {
  const tokens: string[] = [];
  let i = 0;
  while (i < command.length) {
    while (i < command.length && /\s/.test(command[i]!)) i++;
    if (i >= command.length) break;
    const ch = command[i]!;
    if (ch === '"' || ch === "'") {
      const end = command.indexOf(ch, i + 1);
      if (end === -1) return null; // nevyvážené uvozovky — nikdy nehádat
      tokens.push(command.slice(i + 1, end));
      i = end + 1;
    } else {
      const start = i;
      while (i < command.length && !/\s/.test(command[i]!)) {
        const c = command[i]!;
        if (UNQUOTED_METACHAR.test(c)) return null;
        if (c === "$" && (command[i + 1] === "(" || command[i + 1] === "{")) return null;
        i++;
      }
      tokens.push(command.slice(start, i));
    }
  }
  return tokens;
}

function isOkfMemoryBinary(token: string): boolean {
  const base = token.split("/").pop() ?? token;
  return base === "okf-memory" || base === "okf-memory.js";
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
    for (; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok === "--apply") { apply = true; continue; }
      if (tok === "--file" || tok === "--reason" || tok === "--approve-as" || tok === "--if-revision") {
        const value = tokens[++i];
        if (value === undefined || value.startsWith("--")) return null; // flag bez hodnoty
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
