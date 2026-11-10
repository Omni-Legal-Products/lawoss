import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renameSyncWithRetry } from "./windows-rename-retry.js";

// Windows CI lawoss#396: súbežný proces držal cieľ značky a rename skončil s EPERM.

const fsError = (code: string) => Object.assign(new Error(code), { code });
const clock = () => {
  let time = 0;
  return { now: () => time, sleep: (ms: number) => { time += ms; } };
};

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "lawoss-rename-retry-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("skutočné premenovanie nahradí cieľ na každej platforme", async () => {
  const from = join(root, "a.tmp"), to = join(root, "a.json");
  await writeFile(from, "nové");
  await writeFile(to, "staré");
  renameSyncWithRetry(from, to);
  expect(await readFile(to, "utf8")).toBe("nové");
});

test("na Windows sa EPERM, EACCES a EBUSY zopakujú do úspechu", () => {
  for (const code of ["EPERM", "EACCES", "EBUSY"]) {
    let calls = 0;
    renameSyncWithRetry("a", "b", { ...clock(), platform: "win32", rename: () => { calls += 1; if (calls < 3) throw fsError(code); } });
    expect(calls).toBe(3);
  }
});

test("po limite sa vráti pôvodná chyba; iná chyba a iná platforma sa neopakujú", () => {
  const locked = fsError("EPERM");
  let calls = 0;
  expect(() => renameSyncWithRetry("a", "b", { ...clock(), platform: "win32", deadlineMs: 500, rename: () => { calls += 1; throw locked; } })).toThrow(locked);
  expect(calls).toBeGreaterThan(1);
  expect(calls).toBeLessThan(10);

  for (const [platform, code] of [["win32", "ENOENT"], ["linux", "EPERM"], ["darwin", "EBUSY"]] as const) {
    const error = fsError(code);
    calls = 0;
    expect(() => renameSyncWithRetry("a", "b", { ...clock(), platform, rename: () => { calls += 1; throw error; } })).toThrow(error);
    expect(calls).toBe(1);
  }
});
