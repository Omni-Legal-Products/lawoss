import { describe, expect, test } from "bun:test";
import { mkdtemp, realpath as nativeRealpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpath, withShareRootSeparator } from "./canonical-path.js";

describe("canonical-path", () => {
  test("koreň zdieľania Windows dostane lomku ako z resolve(), nič iné sa nemení", () => {
    expect(withShareRootSeparator("\\\\nas\\Kancelaria", "win32")).toBe("\\\\nas\\Kancelaria\\");
    expect(withShareRootSeparator("\\\\nas\\Kancelaria\\", "win32")).toBe("\\\\nas\\Kancelaria\\");
    expect(withShareRootSeparator("\\\\nas\\Kancelaria\\Klienti", "win32")).toBe("\\\\nas\\Kancelaria\\Klienti");
    expect(withShareRootSeparator("C:\\", "win32")).toBe("C:\\");
    expect(withShareRootSeparator("\\\\nas\\Kancelaria", "darwin")).toBe("\\\\nas\\Kancelaria");
  });

  test("mimo koreňa zdieľania je to natívny realpath", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lawoss-canonical-"));
    try {
      expect(await realpath(dir)).toBe(await nativeRealpath(dir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
