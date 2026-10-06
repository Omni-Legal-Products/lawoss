import { mkdtemp, realpath as nativeRealpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "bun:test";
import { realpath, withShareRootSeparator } from "../src/canonical-path.ts";

test("koreň zdieľania Windows dostane lomku ako z resolve(), nič iné sa nemení", () => {
  expect(withShareRootSeparator("\\\\nas\\Kancelaria", "win32")).toBe("\\\\nas\\Kancelaria\\");
  expect(withShareRootSeparator("\\\\nas\\Kancelaria\\", "win32")).toBe("\\\\nas\\Kancelaria\\");
  expect(withShareRootSeparator("\\\\nas\\Kancelaria\\Klienti", "win32")).toBe("\\\\nas\\Kancelaria\\Klienti");
  expect(withShareRootSeparator("C:\\", "win32")).toBe("C:\\");
  expect(withShareRootSeparator("C:\\Klienti", "win32")).toBe("C:\\Klienti");
  // Bun 1.4.2 fs.promises.realpath vracia koreň disku ako `C:` (oven-sh/bun#42581).
  expect(withShareRootSeparator("C:", "win32")).toBe("C:\\");
  expect(withShareRootSeparator("C:", "linux")).toBe("C:");
  expect(withShareRootSeparator("\\\\nas\\Kancelaria", "darwin")).toBe("\\\\nas\\Kancelaria");
  expect(withShareRootSeparator("/Volumes/NAS", "linux")).toBe("/Volumes/NAS");
});

test("mimo koreňa zdieľania je to natívny realpath", async () => {
  const dir = await mkdtemp(join(tmpdir(), "okf-canonical-"));
  try {
    expect(await realpath(dir)).toBe(await nativeRealpath(dir));
    expect(await realpath(await nativeRealpath(dir))).toBe(resolve(await nativeRealpath(dir)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
