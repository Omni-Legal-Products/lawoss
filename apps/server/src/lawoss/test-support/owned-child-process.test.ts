import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { spawnOwnedChild, stopOwnedChild } from "./owned-child-process.js";

const FIXTURE = fileURLToPath(new URL("./owned-child-fixture.ts", import.meta.url));
// Potomok, ktorý SIGTERM ignoruje, ako engine opencode so zaseknutým vypínaním.
const IGNORES_SIGTERM = "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)";

function exists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

async function waitUntilGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (exists(pid) && Date.now() < deadline) await Bun.sleep(50);
  return !exists(pid);
}

describe.skipIf(process.platform === "win32")("owned test child process", () => {
  test("stop escalates to SIGKILL when the child ignores SIGTERM", async () => {
    const child = spawnOwnedChild(process.execPath, ["-e", IGNORES_SIGTERM], { stdio: ["ignore", "pipe", "ignore"] });
    await once(child.stdout!, "data");
    const startedAt = Date.now();
    await stopOwnedChild(child, 200);
    expect(child.signalCode).toBe("SIGKILL");
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  test("stop also ends processes the child started", async () => {
    const script = `const c = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log(c.pid); setInterval(() => {}, 1000)`;
    const child = spawnOwnedChild(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
    const [line] = await once(child.stdout!, "data");
    const grandchild = Number(String(line).trim());
    expect(exists(grandchild)).toBe(true);
    await stopOwnedChild(child, 200);
    expect(await waitUntilGone(grandchild, 2000)).toBe(true);
  });

  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    test(`the child does not outlive a test runner killed with ${signal}`, async () => {
      const runner = spawn(process.execPath, [FIXTURE], { stdio: ["ignore", "pipe", "inherit"] });
      const [line] = await once(runner.stdout, "data");
      const child = Number(String(line).trim());
      expect(exists(child)).toBe(true);
      runner.kill(signal);
      await once(runner, "exit");
      // Strážca to zistí do 200 ms, SIGTERM ignorovaný, SIGKILL po 2 s.
      expect(await waitUntilGone(child, 6000)).toBe(true);
    }, 10_000);
  }
});
