import { readdir, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";

const RUNTIME_DB = /^runtime\.sqlite(?:-wal|-shm|-journal)?$/;
const code = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;

/**
 * Pre testy: zmaže dočasný priečinok testu so serverom.
 *
 * Server drží spojenia na runtime.sqlite otvorené po celý život procesu (`dbByPath`
 * v runtime-opencode-config-store.ts a ďalšie úložiská). Linux a macOS otvorený súbor
 * zmažú, Windows nie (EBUSY). Cez /proc/self/fd sa 5. 10. 2026 ukázalo, že po
 * `server.stop()` ostáva otvorená len runtime.sqlite. Na Windows preto ostane v %TEMP%
 * iba tá; každý iný zablokovaný súbor (napr. neuzavretý watcher) test zhodí ako doteraz.
 */
export async function removeTestDir(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
    return;
  } catch (error) {
    if (process.platform !== "win32" || code(error) !== "EBUSY") throw error;
  }
  await removeAllButRuntimeDb(path);
}

// Prvé `rm` mohlo časť stromu zmazať, preto chýbajúca položka (ENOENT) nie je chyba.
async function removeAllButRuntimeDb(dir: string): Promise<void> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (error) { if (code(error) === "ENOENT") return; throw error; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await removeAllButRuntimeDb(path);
    else if (!RUNTIME_DB.test(entry.name)) await rm(path, { force: true });
    else await rm(path, { force: true }).catch((error) => { if (code(error) !== "EBUSY") throw error; });
  }
  await rmdir(dir).catch((error) => { if (!["ENOTEMPTY", "EBUSY", "ENOENT"].includes(code(error) ?? "")) throw error; });
}
