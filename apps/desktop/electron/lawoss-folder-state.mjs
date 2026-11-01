import { stat } from "node:fs/promises";
import path from "node:path";

/**
 * LAWOSS (N-A7-14, rozhodnutie MČ 30. 10. 2026): karta „Pristúpiť k externému priečinku?“ povie advokátovi, že
 * priečinok neexistuje. Renderer cestu mimo pracovných priestorov overiť nevie, preto sa pýta hlavného procesu.
 * Odpoveď dostane len okno appky (nie agent ani server), takže z nej model nezistí, ktoré priečinky existujú.
 * Iba absolútna cesta; pri inej chybe ako „neexistuje“ `null` (karta nič nepovie).
 *
 * @param {unknown} value
 * @returns {Promise<"dir" | "other" | "missing" | null>}
 */
export async function lawossFolderState(value) {
  if (typeof value !== "string" || !value || value.length > 4096 || value.includes("\0") || !path.isAbsolute(value)) return null;
  try {
    return (await stat(value)).isDirectory() ? "dir" : "other";
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : null;
  }
}
