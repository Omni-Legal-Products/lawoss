import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const scenario of ["web", "manual-web", "native", "native-menu", "native-disabled", "native-ready", "native-downloading", "native-available", "native-missing-check"]) {
  test(`mounted updater: ${scenario}`, () => {
    // Each process owns production imports and their captured browser/storage adapters.
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/electron-updater-mount.tsx", import.meta.url)), scenario], {
      encoding: "utf8", timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
}
