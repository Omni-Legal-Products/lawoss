/** Nezařazené vstupy z `VSTUPY.md` (řádek tabulky s 5. buňkou `pending`). Sdílí kokpit i LAWOSS-lite. */
import type { MatterInput } from "./read";

/** Sloupce podle šablony `templates/spis/VSTUPY.md`: ID, Přijato, Zdroj, Originál, Stav, Výsledné záznamy. */
export type PendingInput = { id: string; received: string; source: string; original: string; matterPath: string; file: string; scope?: "client" };

export function pendingInputs(input: MatterInput): PendingInput[] {
  const rows: PendingInput[] = [];
  const sources: readonly { content: string; file: string; matterPath: string; scope?: "client" }[] = [
    { content: input.intake ?? "", file: input.path ? `${input.path}/VSTUPY.md` : "VSTUPY.md", matterPath: input.path },
    ...(input.inheritedIntakes ?? []).map((source) => ({ content: source.content, file: source.path, matterPath: source.path.split("/").slice(0, -1).join("/"), scope: source.scope })),
  ];
  for (const source of sources) {
    for (const line of source.content.split("\n")) {
      const cells = line.trim().split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells[4] !== "pending") continue; // prázdné ID zůstává "" - kokpit ho ukazoval vždy
      rows.push({ id: cells[0], received: cells[1] ?? "", source: cells[2] ?? "", original: cells[3] ?? "", matterPath: source.matterPath, file: source.file, ...(source.scope ? { scope: source.scope } : {}) });
    }
  }
  return rows;
}
