/** Nezařazené vstupy z `VSTUPY.md` (řádek tabulky s 5. buňkou `pending`). Sdílí kokpit i LAWOSS-lite. */
import type { MatterInput } from "./read";

export type PendingInput = { id: string; received: string; source: string; matterPath: string; file: string };

export function pendingInputs(input: MatterInput): PendingInput[] {
  const file = input.path ? `${input.path}/VSTUPY.md` : "VSTUPY.md";
  const rows: PendingInput[] = [];
  for (const line of (input.intake ?? "").split("\n")) {
    const cells = line.trim().split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells[4] !== "pending" || !cells[0]) continue;
    rows.push({ id: cells[0], received: cells[2] ?? "", source: cells[3] ?? "", matterPath: input.path, file });
  }
  return rows;
}
