/** Nezařazené vstupy z `VSTUPY.md` (řádek tabulky s 5. buňkou `pending`). Sdílí kokpit i LAWOSS-lite. */
import type { MatterInput } from "./read";

/** Sloupce podle šablony `templates/spis/VSTUPY.md`: ID, Přijato, Zdroj, Originál, Stav, Výsledné záznamy. */
export type PendingInput = { id: string; received: string; source: string; original: string; matterPath: string; file: string };

export function pendingInputs(input: MatterInput): PendingInput[] {
  const file = input.path ? `${input.path}/VSTUPY.md` : "VSTUPY.md";
  const rows: PendingInput[] = [];
  for (const line of (input.intake ?? "").split("\n")) {
    const cells = line.trim().split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells[4] !== "pending") continue; // prázdné ID zůstává "" — kokpit ho ukazoval vždy
    rows.push({ id: cells[0], received: cells[1] ?? "", source: cells[2] ?? "", original: cells[3] ?? "", matterPath: input.path, file });
  }
  return rows;
}
