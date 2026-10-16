import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError } from "../errors.js";
import { readWorkspaceText } from "./workspace-text.js";
import { resolveWorkspaceFilePath, recheckWorkspaceFilePath } from "./filesystem-boundary.js";
import { realpath } from "./canonical-path.js";
import { isPathWithin } from "./path-within.js";

const writes = new Map<string, Promise<void>>();

/** Serialize native text saves; external edits are checked again immediately before replacement. */
export async function writeConditionalText(root: string, path: string, content: string, expectedContent: string | null | undefined): Promise<void> {
  const requested = path;
  path = await resolveWorkspaceFilePath(root, requested);
  const previous = writes.get(path) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    const check = async () => {
      await recheckWorkspaceFilePath(root, requested, path);
      if (expectedContent === undefined) return;
      // Config compare-and-save retains its stricter no-descendant-links policy.
      const canonicalRoot = await realpath(root);
      const logical = resolve(root, requested);
      const rel = relative(isPathWithin(resolve(root), logical) ? resolve(root) : canonicalRoot, logical);
      let cursor = canonicalRoot;
      for (const part of rel.split(/[\\/]/)) {
        cursor = join(cursor, part);
        const info = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (info?.isSymbolicLink()) throw new ApiError(400, "invalid_path", "Conditional writes do not follow symbolic links");
      }
      // Rovnaké dekódovanie ako GET /files/content: okf.config s BOM alebo v UTF-16 nie je konflikt.
      const actual = await readWorkspaceText(path).catch((error: NodeJS.ErrnoException) => {
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
