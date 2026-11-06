// LAWOSS: rozpočet RAM 2 GB (#367). Tichá obnova prehľadov číta celú kanceláriu dookola (pri 24 klientoch
// ~14 súborov za sekundu aj pri nečinnosti). Každé čítanie alokuje v hlavnom procese aj v okne, hoci sa súbory
// nemenia. Výpis priečinka sa robí pri každej obnove ďalej a nesie veľkosť a čas zmeny, obsah sa preto stiahne
// len pri zmene. Cache má hornú hranicu a staré položky vypadávajú.

const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
/** Súbor zmenený práve teraz sa neukladá: ďalší zápis v tom istom tiku by mal rovnaký čas (NAS má aj 2 s). */
const RACY_WINDOW_MS = 2_000;

export type CachedFileContent = { path: string; content: string; bytes: number; updatedAt: number };
type Listed = { size?: number; updatedAt?: number };

export function createFileContentCache(options: { maxTotalBytes?: number; maxFileBytes?: number; now?: () => number } = {}) {
  const maxTotal = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const maxFile = options.maxFileBytes ?? MAX_FILE_BYTES;
  const now = options.now ?? Date.now;
  const files = new Map<string, CachedFileContent>();
  let total = 0;
  const keyOf = (workspaceId: string, path: string) => `${workspaceId}\u0000${path}`;
  const remove = (key: string) => {
    const old = files.get(key);
    if (!old) return;
    total -= old.bytes;
    files.delete(key);
  };
  return {
    /** Obsah len vtedy, keď výpis ukazuje tú istú veľkosť aj čas zmeny; inak `null` a volajúci číta zo servera. */
    get(workspaceId: string, path: string, listed: Listed): CachedFileContent | null {
      const key = keyOf(workspaceId, path);
      const hit = files.get(key);
      if (!hit) return null;
      if (hit.updatedAt !== listed.updatedAt || hit.bytes !== listed.size) {
        remove(key);
        return null;
      }
      files.delete(key);
      files.set(key, hit);
      return hit;
    },
    put(workspaceId: string, file: CachedFileContent): void {
      const key = keyOf(workspaceId, file.path);
      remove(key);
      if (file.bytes > maxFile || !(file.updatedAt > 0) || now() - file.updatedAt < RACY_WINDOW_MS) return;
      files.set(key, { path: file.path, content: file.content, bytes: file.bytes, updatedAt: file.updatedAt });
      total += file.bytes;
      for (const oldest of files.keys()) {
        if (total <= maxTotal) break;
        remove(oldest);
      }
    },
    get totalBytes() { return total; },
    get size() { return files.size; },
  };
}

export const okfFileContents = createFileContentCache();
