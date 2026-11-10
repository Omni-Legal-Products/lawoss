import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Writable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ignoreClosedOutput } from "./lawoss-closed-output.mjs";

const moduleUrl = pathToFileURL(fileURLToPath(new URL("./lawoss-closed-output.mjs", import.meta.url))).href;

// Ako hlavný proces Electronu: console.error a priamy zápis do stdout po tom,
// čo čitateľ oboch rúr skončil, a hlásenie nezachytenej výnimky cez console.error.
const CHILD = (guard) => `
${guard ? `const { ignoreClosedOutput } = await import(${JSON.stringify(moduleUrl)}); ignoreClosedOutput();` : ""}
process.on("uncaughtExceptionMonitor", (error) => { console.error("[main] Uncaught exception:", error); });
process.stdin.once("data", async () => {
  for (let i = 0; i < 40; i++) {
    process.stdout.write("GET /session-inbox 200 1ms\\n");
    console.error("[window] chyba", i);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  process.exit(0);
});
`;

function runChild(guard) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD(guard)], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.destroy();
  child.stderr.destroy();
  child.stdin.write("start\n");
  return new Promise((resolve) => child.on("exit", (code) => resolve(code)));
}

test("hlavný proces prežije zatvorené rúry stdout aj stderr", { skip: process.platform === "win32" }, async () => {
  assert.equal(await runChild(true), 0);
});

test("bez ochrany zatvorený výstup proces zhodí (kontrola testu)", { skip: process.platform === "win32" }, async () => {
  assert.notEqual(await runChild(false), 0);
});

test("iná chyba výstupu sa nezamlčí", () => {
  const stream = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  ignoreClosedOutput([stream]);
  assert.doesNotThrow(() => stream.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" })));
  assert.throws(() => stream.emit("error", Object.assign(new Error("write EIO"), { code: "EIO" })), /write EIO/);
});
