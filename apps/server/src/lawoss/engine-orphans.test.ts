import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { engineProcessGroup, reapEngineOrphans, windowsReapScript } from "./engine-orphans.js";

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test.skipIf(process.platform === "win32")("#454: siroty spadnutého enginu (jeho skupina procesov) sa ukončia", async () => {
  // „Engine“ spustí potomka (ako MCP) a potom ho niekto zabije SIGKILL; potomok ostane ako sirota.
  const engine = spawn("/bin/sh", ["-c", "sleep 60 & echo $!; wait"], { stdio: ["ignore", "pipe", "ignore"], ...engineProcessGroup() });
  const orphan = await new Promise<number>((resolve) => engine.stdout?.once("data", (chunk: Buffer) => resolve(Number(chunk.toString().trim()))));
  const exited = new Promise((resolve) => engine.once("exit", resolve));
  engine.kill("SIGKILL");
  await exited;
  expect(alive(orphan)).toBe(true);
  await reapEngineOrphans(engine.pid, Date.now() - 5_000, { graceMs: 200 });
  for (let i = 0; i < 40 && alive(orphan); i++) await Bun.sleep(25);
  expect(alive(orphan)).toBe(false);
});

test("#454: mimo Windows signál ide skupine procesov enginu, na Windows bez novej konzoly", async () => {
  const signals: Array<[number, string]> = [];
  await reapEngineOrphans(4321, 0, { platform: "darwin", graceMs: 0, kill: (pid, signal) => { signals.push([pid, signal]); } });
  expect(signals).toEqual([[-4321, "SIGTERM"], [-4321, "SIGKILL"]]);
  const gone: string[] = [];
  await reapEngineOrphans(4321, 0, { platform: "linux", graceMs: 0, kill: (_pid, signal) => { gone.push(signal); throw new Error("ESRCH"); } });
  expect(gone).toEqual(["SIGTERM"]);
  expect(engineProcessGroup("darwin")).toEqual({ detached: true });
  expect(engineProcessGroup("win32")).toEqual({});
});

test("#454: na Windows sa potomkovia nájdu podľa PID mŕtveho enginu a času vzniku", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  await reapEngineOrphans(4321, 1_700_000_000_000, { platform: "win32", env: { SystemRoot: "C:\\Windows" }, spawn: (command, args) => {
    calls.push({ command, args });
    return { once: (event: string, listener: (...args: unknown[]) => void) => { if (event === "exit") queueMicrotask(() => listener(0)); }, kill: () => {} };
  } });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  expect(calls[0]?.args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"]);
  expect(calls[0]?.args[3]).toBe(windowsReapScript(4321, 1_699_999_999_000));
  expect(windowsReapScript(4321, 1_699_999_999_000)).toContain("$ids=@(4321)");
  expect(windowsReapScript(4321, 1_699_999_999_000)).toContain("FromUnixTimeMilliseconds(1699999999000)");
  expect(windowsReapScript(4321, 1_699_999_999_000)).toContain("Stop-Process -Id $id -Force");
});
