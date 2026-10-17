import { constants, type Stats } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { realpath } from "./canonical-path.js";

const OFFICE_DIRS = ["Office", "_kancelaria"] as const;
const RESERVED = new Set(["index.md", "log.md", "INDEX.md"]);
export const OFFICE_MEMORY_MAX_FILES = 500;
export const OFFICE_MEMORY_MAX_BYTES = 1024 * 1024;
export const OFFICE_MEMORY_TOTAL_BYTES = 8 * 1024 * 1024;
export type OfficeMemoryRead = {
  practiceRoot: string;
  directory: string | null;
  files: { path: string; content: string }[];
  problems: { path: string; message: string }[];
  truncated: boolean;
};
const missing = (e: unknown): boolean => e instanceof Error && "code" in e && e.code === "ENOENT";
const same = (a: Stats, b: Stats): boolean => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;

/** Host-only, bounded bytes; all parent identities are retained and checked before publishing. */
export async function readOfficeMemory(practiceRoot: string, options: { signal?: AbortSignal } = {}): Promise<OfficeMemoryRead> {
  const result: OfficeMemoryRead = { practiceRoot, directory: null, files: [], problems: [], truncated: false };
  const parents: { path: string; stat: Stats }[] = [];
  const directory = async (path: string): Promise<boolean> => {
    let info: Stats;
    try { info = await lstat(path); } catch (error) { if (missing(error)) return false; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Not a regular directory.");
    if (await realpath(path) !== path) throw new Error("Directory identity changed.");
    parents.push({ path, stat: info });
    return true;
  };
  const checkParents = async () => {
    options.signal?.throwIfAborted();
    for (const parent of parents) {
      const current = await lstat(parent.path);
      if (!current.isDirectory() || !same(parent.stat, current) || await realpath(parent.path) !== parent.path) throw new Error("Directory identity changed.");
    }
  };
  // Callers pass a canonical profile root. Retain original spelling in the public response.
  const canonicalRoot = await realpath(practiceRoot);
  await directory(canonicalRoot);
  try {
    let selected: string | undefined;
    for (const name of OFFICE_DIRS) {
      if (await directory(join(canonicalRoot, name))) { selected = name; break; }
    }
    if (!selected) return result;
    result.directory = selected;
    const memory = join(canonicalRoot, selected, "memory");
    if (!await directory(memory)) return result;
    await checkParents();
    const names = (await readdir(memory, { withFileTypes: true })).filter(e => e.isFile() && e.name.endsWith(".md") && !RESERVED.has(e.name)).map(e => e.name).sort((a,b) => a.localeCompare(b));
    result.truncated = names.length > OFFICE_MEMORY_MAX_FILES;
    let total = 0;
    for (const name of names.slice(0, OFFICE_MEMORY_MAX_FILES)) {
      const path = `${selected}/memory/${name}`;
      const absolute = join(memory,name);
      try {
        await checkParents();
        const before = await lstat(absolute);
        if (!before.isFile() || before.isSymbolicLink()) throw new Error("Not a regular file.");
        if (before.size > OFFICE_MEMORY_MAX_BYTES) { result.truncated = true; throw new Error("File exceeds size limit."); }
        if (total + before.size > OFFICE_MEMORY_TOTAL_BYTES) { result.truncated = true; break; }
        const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const owned = await handle.stat();
          if (!owned.isFile() || !same(before,owned)) throw new Error("File identity changed.");
          await checkParents();
          const capacity = Math.min(OFFICE_MEMORY_MAX_BYTES, OFFICE_MEMORY_TOTAL_BYTES - total);
          const bytes = Buffer.alloc(capacity + 1);
          let size = 0;
          while (size < bytes.length) {
            options.signal?.throwIfAborted();
            const read = await handle.read(bytes,size,bytes.length-size,null);
            if (!read.bytesRead) break;
            size += read.bytesRead;
            total += read.bytesRead;
          }
          if (size > capacity) { result.truncated = true; throw new Error("File exceeds read budget."); }
          const after = await handle.stat();
          if (!same(owned,after) || after.size !== size || owned.size !== after.size || owned.mtimeMs !== after.mtimeMs || !same(after,await lstat(absolute))) throw new Error("File changed during read.");
          await checkParents();
          result.files.push({ path, content: bytes.subarray(0,size).toString("utf8") });
        } finally { await handle.close(); }
      } catch (error) {
        options.signal?.throwIfAborted();
        result.problems.push({ path, message: error instanceof Error ? error.message : String(error) });
      }
    }
    await checkParents();
  } catch (error) {
    options.signal?.throwIfAborted();
    result.files = [];
    result.problems.push({ path: result.directory ?? "Office", message: error instanceof Error ? error.message : String(error) });
  }
  return result;
}
