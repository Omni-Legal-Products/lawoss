import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { realpath } from "./canonical-path.js";
import { isPathWithin } from "./path-within.js";
import { readWorkspaceText } from "./workspace-text.js";

/** Kancelária praxe (`Office/`, staršie `_kancelaria/`) v koreni praxe; rovnaké mená ako read-model appky. */
const OFFICE_DIRS = ["Office", "_kancelaria"] as const;
const RESERVED = new Set(["index.md", "log.md", "INDEX.md"]);
export const OFFICE_MEMORY_MAX_FILES = 500;
export const OFFICE_MEMORY_MAX_BYTES = 1024 * 1024;

export type OfficeMemoryRead = {
  /** Priečinok kancelárie voči koreňu praxe; `null`, keď prax kanceláriu nemá. */
  directory: string | null;
  /** Cesty voči koreňu praxe (`Office/memory/…`). */
  files: { path: string; content: string }[];
  problems: { path: string; message: string }[];
  truncated: boolean;
};

const isDirectory = (path: string) => lstat(path).then(info => info.isDirectory(), () => false);

/**
 * Pamäť kancelárie pre prehľad praxe (N1, rozhodnutie MČ 16. 10. 2026). Pri „každý klient zvlášť“
 * leží `Office/` v koreni praxe mimo pracovných priečinkov klientov, takže ju appka cez API
 * pracovného priečinka neprečíta. Len čítanie, len `memory/*.md` bez vnorenia a bez odkazov,
 * každý súbor musí kanonicky ležať v koreni praxe.
 */
export async function readOfficeMemory(practiceRoot: string): Promise<OfficeMemoryRead> {
  const empty: OfficeMemoryRead = { directory: null, files: [], problems: [], truncated: false };
  let directory: string | undefined;
  for (const name of OFFICE_DIRS) if (await isDirectory(join(practiceRoot, name))) { directory = name; break; }
  if (!directory) return empty;
  const memory = join(practiceRoot, directory, "memory");
  if (!(await isDirectory(memory))) return { ...empty, directory };
  const names = (await readdir(memory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith(".md") && !RESERVED.has(entry.name))
    .map(entry => entry.name).sort((a, b) => a.localeCompare(b));
  const result: OfficeMemoryRead = { directory, files: [], problems: [], truncated: names.length > OFFICE_MEMORY_MAX_FILES };
  const canonicalRoot = await realpath(practiceRoot);
  for (const name of names.slice(0, OFFICE_MEMORY_MAX_FILES)) {
    const path = `${directory}/memory/${name}`;
    const absolute = join(memory, name);
    try {
      const info = await lstat(absolute);
      if (!info.isFile()) throw new Error("Not a regular file.");
      if (info.size > OFFICE_MEMORY_MAX_BYTES) throw new Error("File exceeds size limit.");
      if (!isPathWithin(canonicalRoot, await realpath(absolute))) throw new Error("File escapes the practice root.");
      result.files.push({ path, content: await readWorkspaceText(absolute) });
    } catch (error) {
      result.problems.push({ path, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
