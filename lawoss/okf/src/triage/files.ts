/** Súbory roztriedenia v klone: uložené náhľady a klasifikácie od modelu. Všetko pod `.lawoss/triage/`. */
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { TRIAGE_DIR } from "./scan.ts";

export const MAX_JSON_BYTES = 4 * 1024 * 1024;
const errorCode = (error: unknown) => error instanceof Error && "code" in error ? String(error.code) : "";

/** JSON bez nasledovania symbolického odkazu a s hornou hranicou veľkosti (aj keď súbor rastie). */
export async function readJsonFile(path: string, max = MAX_JSON_BYTES): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > max) throw new Error("Súbor nie je obyčajný alebo je príliš veľký.");
    const buffer = Buffer.alloc(max + 1);
    let size = 0;
    while (size < buffer.length) { const read = await handle.read(buffer, size, buffer.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; }
    if (size > max) throw new Error("Súbor je príliš veľký.");
    return JSON.parse(buffer.subarray(0, size).toString("utf8"));
  } finally { await handle.close(); }
}

/** Podpriečinok `.lawoss/triage/<name>` v klone; každá úroveň musí byť skutočný priečinok. */
export async function triageSubdirectory(root: string, name: "plans" | "classifications", create: boolean): Promise<string | null> {
  let current = root;
  for (const part of [...TRIAGE_DIR.split("/"), name]) {
    current = join(current, part);
    if (create) { try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (errorCode(error) !== "EEXIST") throw error; } }
    try {
      const state = await lstat(current);
      if (!state.isDirectory() || state.isSymbolicLink() || await realpath(current) !== current) throw new Error("Priečinok roztriedenia v klone nie je bezpečný.");
    } catch (error) { if (errorCode(error) === "ENOENT" && !create) return null; throw error; }
  }
  return current;
}

/** Nový súbor bez prepisu existujúceho. */
export async function writeNewJson(path: string, value: unknown): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.sync(); } finally { await handle.close(); }
}

/** Klasifikácie od modelu, najnovšia prvá (podľa mena súboru, ktoré začína časom). */
export async function listClassificationFiles(root: string): Promise<string[]> {
  const dir = await triageSubdirectory(root, "classifications", false);
  if (!dir) return [];
  return (await readdir(dir)).filter(name => /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.json$/.test(name)).sort().reverse().map(name => join(dir, name));
}
