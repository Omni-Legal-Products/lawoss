import { describe, expect, test } from "bun:test";
import { spawn, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

import { killProcessTree, taskkillPath } from "./process-tree.js";

type Call = { command: string; args: string[]; options: SpawnOptions };

class FakeTaskkill extends EventEmitter {
  killed = false;
  kill() {
    this.killed = true;
    return true;
  }
}

// Falošný spawn: zapíše volanie a nechá test rozhodnúť, ako taskkill skončí.
function fakeSpawn(finish: (child: FakeTaskkill) => void = (child) => setImmediate(() => child.emit("exit", 0))) {
  const calls: Call[] = [];
  const children: FakeTaskkill[] = [];
  const spawnFake = (command: string, args: string[], options: SpawnOptions) => {
    calls.push({ command, args, options });
    const child = new FakeTaskkill();
    children.push(child);
    finish(child);
    return child;
  };
  return { calls, children, spawn: spawnFake };
}

const WINDOWS_ENV = { SystemRoot: "C:\\Windows" };

describe("killProcessTree", () => {
  test("mimo Windows nič nespúšťa a postup upstreamu ostáva", async () => {
    for (const platform of ["linux", "darwin"] as const) {
      const fake = fakeSpawn();
      expect(await killProcessTree(1234, { platform, spawn: fake.spawn })).toBe(false);
      expect(fake.calls).toEqual([]);
    }
  });

  test("na Windows zavolá taskkill /T /F s plnou cestou a bez okna", async () => {
    const fake = fakeSpawn();
    expect(await killProcessTree(1234, { platform: "win32", env: WINDOWS_ENV, spawn: fake.spawn })).toBe(true);
    expect(fake.calls).toEqual([{
      command: "C:\\Windows\\System32\\taskkill.exe",
      args: ["/pid", "1234", "/T", "/F"],
      options: { stdio: "ignore", windowsHide: true },
    }]);
  });

  test("neplatné PID taskkill nespustí", async () => {
    for (const pid of [undefined, null, 0, -1, Number.NaN, 1.5]) {
      const fake = fakeSpawn();
      expect(await killProcessTree(pid, { platform: "win32", env: WINDOWS_ENV, spawn: fake.spawn })).toBe(false);
      expect(fake.calls).toEqual([]);
    }
  });

  test("zlyhanie taskkill nevyhodí výnimku", async () => {
    const notFound = fakeSpawn((child) => setImmediate(() => child.emit("exit", 128)));
    expect(await killProcessTree(1234, { platform: "win32", env: WINDOWS_ENV, spawn: notFound.spawn })).toBe(false);

    const failed = fakeSpawn((child) => setImmediate(() => child.emit("error", new Error("ENOENT"))));
    expect(await killProcessTree(1234, { platform: "win32", env: WINDOWS_ENV, spawn: failed.spawn })).toBe(false);

    const throwing = (): FakeTaskkill => {
      throw new Error("spawn EPERM");
    };
    expect(await killProcessTree(1234, { platform: "win32", env: WINDOWS_ENV, spawn: throwing })).toBe(false);
  });

  test("zaseknutý taskkill po limite ukončí a vráti false", async () => {
    const hanging = fakeSpawn(() => {});
    expect(await killProcessTree(1234, { platform: "win32", env: WINDOWS_ENV, spawn: hanging.spawn, timeoutMs: 20 })).toBe(false);
    expect(hanging.children[0]?.killed).toBe(true);
  });

  test("taskkill.exe sa hľadá v SystemRoot, nie v PATH", () => {
    expect(taskkillPath({ SystemRoot: "D:\\WINDOWS" })).toBe("D:\\WINDOWS\\System32\\taskkill.exe");
    expect(taskkillPath({ windir: "E:\\Win" })).toBe("E:\\Win\\System32\\taskkill.exe");
    expect(taskkillPath({})).toBe("C:\\Windows\\System32\\taskkill.exe");
  });
});

// Skutočný strom procesov na Windows: rodič (node) spustí vnúča (node), ktoré len
// spí, vypíše jeho PID a čaká. Samotné child.kill() by vnúča nechalo bežať.
const PARENT_SCRIPT = `
const { spawn } = require("node:child_process");
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
process.stdout.write(grandchild.pid + "\\n");
setInterval(() => {}, 1000);
`;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

async function waitUntilGone(pid: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  return !isAlive(pid);
}

function firstLine(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.includes("\n")) resolve(buffer.slice(0, buffer.indexOf("\n")).trim());
    });
    stream.once("end", () => reject(new Error(`rodič nevypísal PID vnúčaťa: ${buffer}`)));
  });
}

test.skipIf(process.platform !== "win32")("na Windows zhodí aj vnúča, ktoré by child.kill nechal bežať", async () => {
  // Pod bun je process.execPath bun; strom má byť z node ako pri nástrojoch agenta.
  const node = process.versions.bun ? "node" : process.execPath;
  const parent = spawn(node, ["-e", PARENT_SCRIPT], { stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
  let grandchild = 0;
  try {
    if (!parent.stdout) throw new Error("rodič nemá stdout");
    grandchild = Number(await firstLine(parent.stdout));
    expect(Number.isInteger(grandchild) && grandchild > 0).toBe(true);
    expect(isAlive(grandchild)).toBe(true);

    // Návratovú hodnotu netestujeme: conhost.exe v strome môže skončiť sám počas
    // taskkill a ten potom hlási chybu, hoci strom už nebeží. Rozhoduje vnúča.
    await killProcessTree(parent.pid);

    expect(await waitUntilGone(grandchild)).toBe(true);
    expect(await waitUntilGone(parent.pid ?? 0)).toBe(true);
  } finally {
    for (const pid of [grandchild, parent.pid ?? 0]) {
      try {
        if (pid) process.kill(pid);
      } catch {
        // Už neexistuje.
      }
    }
  }
}, 30_000);
