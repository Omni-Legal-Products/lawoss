import { describe, expect, test } from "bun:test";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
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

/** Zdroj funkcie od hlavičky po zatváraciu zátvorku s rovnakým odsadením. */
function functionSource(file: string, signature: string): string {
  const source = readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf(signature);
  expect(start).not.toBe(-1);
  const indent = source.slice(source.lastIndexOf("\n", start) + 1, start);
  const end = source.indexOf(`\n${indent}}\n`, start);
  expect(end).not.toBe(-1);
  return source.slice(start, end);
}

// makeTerminator sa neexportuje a strom sa reálne overuje len na Windows. Preto aspoň
// všade overíme poradie: taskkill /T hľadá potomkov podľa PID enginu, takže musí
// bežať pred prvým child.kill, kým engine ešte žije.
test("makeTerminator zhodí na Windows strom pred prvým child.kill", () => {
  const makeTerminator = functionSource("../managed-opencode.ts", "function makeTerminator(");
  expect(makeTerminator.slice(0, makeTerminator.indexOf("child.kill("))).toMatch(
    /if \(process\.platform === "win32"\) await killProcessTree\(child\.pid\);\s*try \{\s*$/,
  );
  expect(makeTerminator).toMatch(/await killProcessTree\(child\.pid\);\s*try \{\s*child\.kill\("SIGTERM"\);/);
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

// Koniec rodiča podľa jeho handle; holé PID po skončení procesu môže patriť inému.
function waitForExit(child: ChildProcess, timeoutMs = 10_000): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
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
  let grandchildGone = false;
  try {
    if (!parent.stdout) throw new Error("rodič nemá stdout");
    grandchild = Number(await firstLine(parent.stdout));
    expect(Number.isInteger(grandchild) && grandchild > 0).toBe(true);
    grandchildGone = !isAlive(grandchild);
    expect(grandchildGone).toBe(false);

    // Návratovú hodnotu netestujeme: conhost.exe v strome môže skončiť sám počas
    // taskkill a ten potom hlási chybu, hoci strom už nebeží. Rozhoduje vnúča.
    await killProcessTree(parent.pid);

    grandchildGone = await waitUntilGone(grandchild);
    expect(grandchildGone).toBe(true);
    expect(await waitForExit(parent)).toBe(true);
  } finally {
    // Windows pridelí PID skončeného procesu rýchlo inému a bun test v CI beží vedľa
    // iných procesov. Rodiča preto zhodí jeho handle, ktorý po skončení nič nezabije,
    // a holé PID vnúčaťa len vtedy, keď sme jeho koniec nepotvrdili.
    parent.kill();
    if (grandchild && !grandchildGone) {
      try {
        process.kill(grandchild);
      } catch {
        // Už neexistuje.
      }
    }
  }
}, 30_000);
