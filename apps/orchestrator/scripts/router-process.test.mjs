import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

import { stopProcessTree } from "./router-process.mjs";

test("stopProcessTree bounds shutdown when a child ignores SIGTERM", async () => {
  const child = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  await once(child, "spawn");

  const startedAt = Date.now();
  await stopProcessTree(child, 100);

  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.ok(Date.now() - startedAt < 2000);
});
