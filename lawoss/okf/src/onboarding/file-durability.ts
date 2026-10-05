import { constants } from "node:fs";
import { chmod, lstat, open, unlink } from "node:fs/promises";

const errorCode = (error: unknown) => error && typeof error === "object" && "code" in error ? String(error.code) : "";

/**
 * Zápis obsahu kópie na disk (fsync). Windows: FlushFileBuffers potrebuje handle s
 * právom zápisu a CopyFileW skopíruje aj atribút „iba na čítanie“, takže kópiu
 * dokumentu označeného iba na čítanie (PDF, export z DMS, súbor z CD) nešlo otvoriť
 * na zápis (EPERM). Atribút sa zruší len na čas flushu a potom sa vráti.
 */
export async function syncFile(path: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform !== "win32") {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
    return;
  }
  const { mode } = await lstat(path);
  const readOnly = (mode & 0o200) === 0;
  if (readOnly) await chmod(path, mode | 0o200);
  try {
    const handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
  } finally { if (readOnly) await chmod(path, mode & 0o7777); }
}

/** Zmazanie súboru. Windows: DeleteFileW odmietne súbor iba na čítanie (EPERM); atribút sa zruší a zmaže sa znova. */
export async function unlinkFile(path: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  try { await unlink(path); }
  catch (error) {
    if (platform !== "win32" || errorCode(error) !== "EPERM") throw error;
    const { mode } = await lstat(path);
    if ((mode & 0o200) !== 0) throw error;
    await chmod(path, mode | 0o200);
    await unlink(path);
  }
}
