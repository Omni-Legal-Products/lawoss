import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statWithAdvancedMtime } from "./advance-mtime.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop() ?? "", { recursive: true, force: true }); });

test("zápis so zhodným časom zmeny posunie mtime za pôvodný (Windows granularita)", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-mtime-")); roots.push(root);
  const path = join(root, "a.txt");
  await writeFile(path, "before");
  const fixed = new Date(1_800_000_000_000);
  await utimes(path, fixed, fixed);
  const before = (await stat(path)).mtimeMs;
  await writeFile(path, "after");
  await utimes(path, fixed, fixed); // simulácia rovnakého tiku hodín
  const after = await statWithAdvancedMtime(path, before);
  expect(after.mtimeMs).toBeGreaterThan(before);
});

test("novší mtime ani nový súbor sa nemenia", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-mtime-")); roots.push(root);
  const path = join(root, "b.txt");
  await writeFile(path, "x");
  const current = (await stat(path)).mtimeMs;
  expect((await statWithAdvancedMtime(path, current - 10_000)).mtimeMs).toBe(current);
  expect((await statWithAdvancedMtime(path, null)).mtimeMs).toBe(current);
});
