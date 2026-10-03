import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError } from "../errors.js";

const writes = new Map<string, Promise<void>>();

/** Serialize native text saves; external edits are checked again immediately before replacement. */
export async function writeConditionalText(root: string, path: string, content: string, expectedContent: string | null | undefined): Promise<void> {
  const previous = writes.get(path) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    const check = async () => {
      if (expectedContent === undefined) return;
      let cursor = root;
      for (const part of relative(root, path).split(/[\\/]/)) {
        cursor = join(cursor, part);
        const info = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (info?.isSymbolicLink()) throw new ApiError(400, "invalid_path", "Conditional writes do not follow symbolic links");
      }
      const actual = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (actual !== expectedContent) throw new ApiError(409, "conflict", "Konfigurácia sa zmenila. Načítajte ju znovu a zopakujte úpravu.");
    };
    await check();
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: expectedContent === undefined ? 0o666 : 0o600 });
      await check();
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  });
  writes.set(path, current);
  try { await current; } finally { if (writes.get(path) === current) writes.delete(path); }
}
