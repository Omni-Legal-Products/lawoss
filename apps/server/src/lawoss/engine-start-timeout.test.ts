import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createManagedOpencodeServer } from "../managed-opencode.js";
import {
  DEFAULT_ENGINE_START_TIMEOUT_MS,
  ENGINE_START_TIMEOUT_ENV,
  WINDOWS_ENGINE_START_TIMEOUT_MS,
  engineStartTimeoutMs,
} from "./engine-start-timeout.js";

describe("engineStartTimeoutMs", () => {
  test("na Windows čaká dlhšie, inde ostáva upstream 15 s", () => {
    expect(DEFAULT_ENGINE_START_TIMEOUT_MS).toBe(15_000);
    expect(engineStartTimeoutMs({ platform: "win32", env: {} })).toBe(WINDOWS_ENGINE_START_TIMEOUT_MS);
    expect(WINDOWS_ENGINE_START_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(engineStartTimeoutMs({ platform: "darwin", env: {} })).toBe(DEFAULT_ENGINE_START_TIMEOUT_MS);
    expect(engineStartTimeoutMs({ platform: "linux", env: {} })).toBe(DEFAULT_ENGINE_START_TIMEOUT_MS);
  });

  test("platné nastavenie v prostredí má prednosť na každej platforme", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      expect(engineStartTimeoutMs({ platform, env: { [ENGINE_START_TIMEOUT_ENV]: "45000" } })).toBe(45_000);
      expect(engineStartTimeoutMs({ platform, env: { [ENGINE_START_TIMEOUT_ENV]: " 30000 " } })).toBe(30_000);
    }
  });

  test("neplatné nastavenie ignoruje a vráti predvolenú hodnotu platformy", () => {
    for (const value of ["", "abc", "-5000", "1.5", "45s", "999", "600001", "1e5"]) {
      expect(engineStartTimeoutMs({ platform: "win32", env: { [ENGINE_START_TIMEOUT_ENV]: value } })).toBe(WINDOWS_ENGINE_START_TIMEOUT_MS);
      expect(engineStartTimeoutMs({ platform: "darwin", env: { [ENGINE_START_TIMEOUT_ENV]: value } })).toBe(DEFAULT_ENGINE_START_TIMEOUT_MS);
    }
  });
});

// Falošný engine, ktorý sa nikdy neohlási; node skript so shebangom, preto nie na Windows.
const SILENT_OPENCODE = `#!/usr/bin/env node
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1 << 30);
`;

let dir: string | null = null;
const previous = process.env[ENGINE_START_TIMEOUT_ENV];
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
  if (previous === undefined) delete process.env[ENGINE_START_TIMEOUT_ENV];
  else process.env[ENGINE_START_TIMEOUT_ENV] = previous;
});

test.skipIf(process.platform === "win32")("createManagedOpencodeServer bez timeoutMs použije limit z engineStartTimeoutMs", async () => {
  dir = mkdtempSync(join(tmpdir(), "engine-start-timeout-"));
  const bin = join(dir, "fake-opencode");
  writeFileSync(bin, SILENT_OPENCODE, "utf8");
  chmodSync(bin, 0o755);
  process.env[ENGINE_START_TIMEOUT_ENV] = "1000";
  const start = Date.now();
  await expect(createManagedOpencodeServer({ bin, cwd: dir })).rejects.toThrow(/after 1000ms/);
  expect(Date.now() - start).toBeLessThan(8000);
}, 20000);

// Pevný timeoutMs pri volaní obíde limit pre Windows aj LAWOSS_ENGINE_START_TIMEOUT_MS
// (verejný scratch engine mal natvrdo 15 s, lawoss#185).
test("produkčné volania createManagedOpencodeServer nepredávajú pevný timeoutMs", async () => {
  const root = join(import.meta.dir, "..");
  const offenders: string[] = [];
  for await (const file of new Bun.Glob("**/*.ts").scan(root)) {
    if (file.includes(".test.")) continue;
    const source = await Bun.file(join(root, file)).text();
    for (const call of source.matchAll(/createManagedOpencodeServer\(\{[\s\S]*?\}\)/g)) {
      if (/timeoutMs:\s*[\d_]+/.test(call[0])) offenders.push(file);
    }
  }
  expect(offenders).toEqual([]);
});
