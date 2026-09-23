/**
 * Rozpozná návrh zápisu do paměti věci (`okf-memory write …`) v příkazu bash
 * permission requestu, aby se v lite zobrazila srozumitelná karta místo
 * syrového shellu. Cokoli mimo přesný tvar `[node|bun] <cesta k okf-memory>
 * write <spis> [--file …] [--reason …] [--apply] [--approve-as …]`
 * (zmínka v jiném příkazu, jiný podpříkaz, chybějící spis) vrací `null` —
 * karta se pak nezobrazí a panel zůstane beze změny (Review Focus 5).
 */

export type MemoryWriteProposal = {
  matterDir: string;
  file?: string;
  reason?: string;
  apply: boolean;
  approvedBy?: string;
};

/** Rozdělí příkaz na tokeny; uvozovky `"…"`/`'…'` drží obsah pohromadě. */
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
      while (i < command.length && !/\s/.test(command[i]!)) i++;
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
      if (tok === "--file") file = tokens[++i];
      else if (tok === "--reason") reason = tokens[++i];
      else if (tok === "--apply") apply = true;
      else if (tok === "--approve-as") approvedBy = tokens[++i];
      else if (tok === "--if-revision") i++; // cíl úpravy, nepotřebné pro kartu
    }

    return { matterDir, file, reason, apply, approvedBy };
  } catch {
    return null;
  }
}
