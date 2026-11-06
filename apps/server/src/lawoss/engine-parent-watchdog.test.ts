import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { watchEngineParent } from "./engine-parent-watchdog.js";

const posix = process.platform !== "win32";
const roots: string[] = [];
const pids: number[] = [];
afterEach(async () => {
  for (const pid of pids.splice(0)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitDead(pid: number, ms: number) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (!alive(pid)) return true; await delay(50); }
  return !alive(pid);
}

// Falošný engine: spustí jedného potomka (ako MCP), PID oboch zapíše do súboru.
async function scenario(ignoreTerm: boolean) {
  const root = await mkdtemp(join(tmpdir(), "lawoss-engine-watchdog-"));
  roots.push(root);
  const engine = join(root, "engine.mjs");
  await writeFile(engine, `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const mcp = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(process.argv[2], JSON.stringify({ engine: process.pid, mcp: mcp.pid }));
process.on("SIGTERM", () => { if (${ignoreTerm}) return; mcp.kill("SIGTERM"); process.exit(0); });
setInterval(() => {}, 1000);
`);
  const main = join(root, "main.ts");
  await writeFile(main, `
import { spawn } from "node:child_process";
import { watchEngineParent } from ${JSON.stringify(join(import.meta.dir, "engine-parent-watchdog.ts"))};
const engine = spawn(process.execPath, [${JSON.stringify(engine)}, ${JSON.stringify(join(root, "pids.json"))}], { stdio: "ignore" });
watchEngineParent(engine, { graceSeconds: 1 });
setInterval(() => {}, 1000);
`);
  const parent = Bun.spawn([process.execPath, main], { stdio: ["ignore", "ignore", "inherit"] });
  pids.push(parent.pid);
  let ids: { engine: number; mcp: number } | null = null;
  for (let i = 0; i < 100 && !ids; i++) {
    ids = await readFile(join(root, "pids.json"), "utf8").then(JSON.parse).catch(() => null);
    if (!ids) await delay(50);
  }
  if (!ids) throw new Error("fake engine did not start");
  pids.push(ids.engine, ids.mcp);
  return { parent, ids };
}

test.skipIf(!posix)("pád hlavného procesu ukončí engine a ten svoje MCP", async () => {
  const { parent, ids } = await scenario(false);
  await delay(200);
  expect(alive(ids.engine)).toBe(true);
  parent.kill("SIGKILL");
  expect(await waitDead(ids.engine, 3000)).toBe(true);
  expect(await waitDead(ids.mcp, 3000)).toBe(true);
});

test.skipIf(!posix)("engine, ktorý ignoruje SIGTERM, dostane po odklade SIGKILL aj s potomkami", async () => {
  const { parent, ids } = await scenario(true);
  await delay(200);
  parent.kill("SIGKILL");
  await delay(400);
  expect(alive(ids.engine)).toBe(true);
  expect(await waitDead(ids.engine, 4000)).toBe(true);
  expect(await waitDead(ids.mcp, 2000)).toBe(true);
});

test.skipIf(!posix)("bežné ukončenie enginu odstráni strážcu bez zásahu", async () => {
  const { spawn } = await import("node:child_process");
  const engine = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"], { stdio: "ignore" });
  let watchdogPid = 0;
  const watchdog = watchEngineParent(engine, {
    spawnProcess: ((command: string, args: string[], options: object) => {
      const child = spawn(command, args, options);
      watchdogPid = child.pid ?? 0;
      return child;
    }) as typeof spawn,
  });
  expect(watchdogPid).toBeGreaterThan(0);
  await new Promise((resolve) => engine.once("exit", resolve));
  expect(await waitDead(watchdogPid, 2000)).toBe(true);
  watchdog.stop();
});

test("na Windows strážca nevznikne", () => {
  let spawned = false;
  const watchdog = watchEngineParent({ pid: 123, once: () => undefined } as never, { platform: "win32", spawnProcess: (() => { spawned = true; }) as never });
  expect(spawned).toBe(false);
  watchdog.stop();
});
