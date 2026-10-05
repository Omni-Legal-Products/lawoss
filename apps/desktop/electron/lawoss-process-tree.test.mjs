import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { killProcessTree, taskkillPath } from "./lawoss-process-tree.mjs";

// Falošný spawn: zapíše volanie a nechá test rozhodnúť, ako taskkill skončí.
/** @param {(child: EventEmitter) => void} [finish] */
function fakeSpawn(finish = (child) => { setImmediate(() => child.emit("exit", 0)); }) {
  const calls = [];
  const children = [];
  const spawnFake = (command, args, options) => {
    calls.push({ command, args, options });
    const child = Object.assign(new EventEmitter(), { killed: false, kill() { this.killed = true; return true; } });
    children.push(child);
    finish(child);
    return child;
  };
  return { calls, children, spawn: spawnFake };
}

const WINDOWS_ENV = { SystemRoot: "C:\\Windows" };

test("mimo Windows nič nespúšťa a postup upstreamu ostáva", async () => {
  /** @type {NodeJS.Platform[]} */
  const platforms = ["linux", "darwin"];
  for (const platform of platforms) {
    const fake = fakeSpawn();
    assert.equal(await killProcessTree(1234, { platform, spawn: fake.spawn }), false);
    assert.deepEqual(fake.calls, []);
  }
});

test("na Windows zavolá taskkill /T /F s plnou cestou a bez okna", async () => {
  const fake = fakeSpawn();
  assert.equal(await killProcessTree(1234, { platform: "win32", env: WINDOWS_ENV, spawn: fake.spawn }), true);
  assert.deepEqual(fake.calls, [{
    command: "C:\\Windows\\System32\\taskkill.exe",
    args: ["/pid", "1234", "/T", "/F"],
    options: { stdio: "ignore", windowsHide: true },
  }]);
});

test("neplatné PID taskkill nespustí", async () => {
  for (const pid of [undefined, null, 0, -1, Number.NaN, 1.5]) {
    const fake = fakeSpawn();
    assert.equal(await killProcessTree(pid, { platform: "win32", env: WINDOWS_ENV, spawn: fake.spawn }), false);
    assert.deepEqual(fake.calls, []);
  }
});

test("zlyhanie taskkill nevyhodí výnimku", async () => {
  const notFound = fakeSpawn((child) => { setImmediate(() => child.emit("exit", 128)); });
  assert.equal(await killProcessTree(1234, { platform: "win32", env: WINDOWS_ENV, spawn: notFound.spawn }), false);

  const error = fakeSpawn((child) => { setImmediate(() => child.emit("error", new Error("ENOENT"))); });
  assert.equal(await killProcessTree(1234, { platform: "win32", env: WINDOWS_ENV, spawn: error.spawn }), false);

  const throwing = () => {
    throw new Error("spawn EPERM");
  };
  assert.equal(await killProcessTree(1234, { platform: "win32", env: WINDOWS_ENV, spawn: throwing }), false);
});

test("zaseknutý taskkill po limite ukončí a vráti false", async () => {
  const hanging = fakeSpawn(() => {});
  assert.equal(await killProcessTree(1234, { platform: "win32", env: WINDOWS_ENV, spawn: hanging.spawn, timeoutMs: 20 }), false);
  assert.equal(hanging.children[0].killed, true);
});

test("taskkill.exe sa hľadá v SystemRoot, nie v PATH", () => {
  assert.equal(taskkillPath({ SystemRoot: "D:\\WINDOWS" }), "D:\\WINDOWS\\System32\\taskkill.exe");
  assert.equal(taskkillPath({ windir: "E:\\Win" }), "E:\\Win\\System32\\taskkill.exe");
  assert.equal(taskkillPath({}), "C:\\Windows\\System32\\taskkill.exe");
});

/**
 * Zdroj funkcie od hlavičky po zatváraciu zátvorku s rovnakým odsadením.
 * @param {string} file @param {string} signature
 */
function functionSource(file, signature) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `v ${file} chýba ${signature}`);
  const indent = source.slice(source.lastIndexOf("\n", start) + 1, start);
  const end = source.indexOf(`\n${indent}}\n`, start);
  assert.notEqual(end, -1, `v ${file} chýba koniec ${signature}`);
  return source.slice(start, end);
}

// stopChild je vnútri createRuntimeManager, ktorý test bez Electronu nespustí, a strom
// sa reálne overuje len na Windows. Preto aspoň všade overíme poradie: taskkill /T
// hľadá potomkov podľa PID rodiča, takže musí bežať pred prvým child.kill.
test("stopChild zhodí na Windows strom pred prvým child.kill", () => {
  const stopChild = functionSource("./runtime.mjs", "async function stopChild(");
  assert.match(
    stopChild.slice(0, stopChild.indexOf("child.kill(")),
    /if \(process\.platform === "win32"\) await killProcessTree\(child\.pid\);\s*$/,
  );
  assert.match(stopChild, /await killProcessTree\(child\.pid\);\s*child\.kill\("SIGTERM"\);/);
});

// Skutočný strom procesov na Windows: rodič (node) spustí vnúča (node), ktoré len
// spí, vypíše jeho PID a čaká. Samotné child.kill() by vnúča nechalo bežať.
const PARENT_SCRIPT = `
const { spawn } = require("node:child_process");
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
process.stdout.write(grandchild.pid + "\\n");
setInterval(() => {}, 1000);
`;

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitUntilGone(pid, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  return !isAlive(pid);
}

// Koniec rodiča podľa jeho handle; holé PID po skončení procesu môže patriť inému.
function waitForExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function firstLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.includes("\n")) resolve(buffer.slice(0, buffer.indexOf("\n")).trim());
    });
    stream.once("end", () => reject(new Error(`rodič nevypísal PID vnúčaťa: ${buffer}`)));
  });
}

test("na Windows zhodí aj vnúča, ktoré by child.kill nechal bežať", { skip: process.platform !== "win32", timeout: 30_000 }, async () => {
  const parent = spawn(process.execPath, ["-e", PARENT_SCRIPT], { stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
  let grandchild = 0;
  let grandchildGone = false;
  try {
    grandchild = Number(await firstLine(parent.stdout));
    assert.ok(Number.isInteger(grandchild) && grandchild > 0, `PID vnúčaťa: ${grandchild}`);
    grandchildGone = !isAlive(grandchild);
    assert.equal(grandchildGone, false, "vnúča pred ukončením nebeží");

    // Návratovú hodnotu netestujeme: conhost.exe v strome môže skončiť sám počas
    // taskkill a ten potom hlási chybu, hoci strom už nebeží. Rozhoduje vnúča.
    await killProcessTree(parent.pid);

    grandchildGone = await waitUntilGone(grandchild);
    assert.equal(grandchildGone, true, "vnúča po taskkill /T stále beží");
    assert.equal(await waitForExit(parent), true, "rodič po taskkill /T stále beží");
  } finally {
    // Windows pridelí PID skončeného procesu rýchlo inému a node --test púšťa súbory
    // súbežne. Rodiča preto zhodí jeho handle, ktorý po skončení nič nezabije, a holé
    // PID vnúčaťa len vtedy, keď sme jeho koniec nepotvrdili.
    parent.kill();
    if (grandchild && !grandchildGone) {
      try {
        process.kill(grandchild);
      } catch {
        // Už neexistuje.
      }
    }
  }
});
