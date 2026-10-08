import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function safeId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value); }
export function isHash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function missing(error: unknown): boolean { return isObject(error) && error.code === "ENOENT"; }
export function contained(root: string, target: string): boolean { const rel = relative(root, target); return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)); }
/** Check every existing component, including ancestors; never resolve through a symlink. */
export function checkedPath(path: string, kind: "file" | "directory", allowMissing = false): boolean {
  const full = resolve(path), root = parse(full).root;
  const parts = relative(root, full).split(sep).filter(Boolean);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = resolve(current, parts[i]!);
    let stat;
    try { stat = lstatSync(current); } catch (error) { if (allowMissing && missing(error)) return false; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${current}`);
    if (i < parts.length - 1 || kind === "directory") { if (!stat.isDirectory()) throw new Error(`Not a directory: ${current}`); }
    else if (!stat.isFile()) throw new Error(`Not a regular file: ${current}`);
  }
  return true;
}
/** An explicitly selected authority root may be an alias, including its ancestors. */
export function checkedDirectory(path: string): string { const physical = resolve(realpathSync.native(path)); checkedPath(physical, "directory"); return physical; }
/**
 * Resolve a child inside its selected authority root, including a missing tail.
 * A symlink never grants access to another root. Keep checkedPath strict for
 * subsequent I/O on the physical path (a later symlink replacement must fail).
 */
export function physicalPathWithin(root: string, path: string, kind: "file" | "directory", allowMissing = false): string {
  if (path.split(/[\\/]/).includes("..")) throw new Error(`Traversal is not allowed: ${path}`);
  const logicalRoot = resolve(root), physicalRoot = checkedDirectory(root), logical = resolve(root, path);
  if (!contained(logicalRoot, logical)) throw new Error(`Path outside authority root: ${path}`);
  let ancestor = logical;
  const tail: string[] = [];
  let physical: string;
  for (;;) {
    try { physical = resolve(realpathSync.native(ancestor)); break; }
    catch (error) { if (!allowMissing || !missing(error)) throw error; }
    if (lstatSync(ancestor, { throwIfNoEntry: false })) throw new Error(`Dangling symlink is not allowed: ${ancestor}`);
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error(`No existing ancestor: ${logical}`);
    tail.unshift(basename(ancestor)); ancestor = parent;
  }
  const target = join(physical, ...tail);
  if (!contained(physicalRoot, target)) throw new Error(`Path outside authority root through symlink: ${logical}`);
  checkedPath(target, kind, allowMissing);
  return target;
}
interface ReadText { content: string; sha256: string; bytes: number; physical: string; mode: number }
export function readText(path: string, limit: number): ReadText {
  checkedPath(path, "file");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    // NTFS file IDs can exceed Number.MAX_SAFE_INTEGER; distinct sources must stay distinct.
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile()) throw new Error(`Not a regular file: ${path}`);
    if (before.size > BigInt(limit)) throw new Error(`Byte limit ${limit} exceeded: ${path}`);
    // Bounded even when a writer grows the file during the read.
    const buffer = Buffer.alloc(Math.min(Number(before.size) + 1, limit + 1));
    let count = 0;
    while (count < buffer.length) { const n = readSync(fd, buffer, count, buffer.length - count, null); if (n === 0) break; count += n; }
    const after = fstatSync(fd, { bigint: true }), named = lstatSync(path, { bigint: true });
    if (BigInt(count) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || named.isSymbolicLink() || before.ino !== named.ino || before.dev !== named.dev) throw new Error(`Source changed during read: ${path}`);
    const bytes = buffer.subarray(0, count);
    // ignoreBOM keeps a UTF-8 BOM in the returned text for exact round trips.
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { content, sha256: sha256(bytes), bytes: count, physical: `${before.dev}:${before.ino}`, mode: Number(before.mode & 0o777n) };
  } finally { closeSync(fd); }
}
export function jsonText(path: string, limit: number): unknown { return JSON.parse(readText(path, limit).content); }
