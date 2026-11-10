import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { writeLogLine } from "./safe-log-write.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function failingStream(code: string) {
  let writes = 0;
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      writes += 1;
      callback(Object.assign(new Error(`write ${code}`), { code, syscall: "write" }));
    },
  });
  return { stream, writes: () => writes };
}

test("EPIPE pri zápise logu nevyhodí výnimku a ďalšie riadky sa zahodia", async () => {
  const { stream, writes } = failingStream("EPIPE");
  writeLogLine("prvý\n", stream);
  await delay(10);
  writeLogLine("druhý\n", stream);
  await delay(10);
  expect(writes()).toBe(1);
});

test("iná chyba výstupu sa nezamlčí", () => {
  const stream = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  writeLogLine("riadok\n", stream);
  expect(() => stream.emit("error", Object.assign(new Error("write EIO"), { code: "EIO" }))).toThrow("write EIO");
});

test("riadky sa zapíšu, kým je výstup otvorený", () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  writeLogLine("a\n", stream);
  writeLogLine("b\n", stream);
  expect(lines).toEqual(["a\n", "b\n"]);
});

// Ako v desktope: proces s logom servera beží ďalej, keď čitateľ jeho stdout (rúry) skončí.
test.skipIf(process.platform === "win32")("Node proces prežije zatvorenú rúru stdout", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-log-epipe-"));
  roots.push(root);
  const script = join(root, "child.mjs");
  await writeFile(script, `
import { writeLogLine } from ${JSON.stringify(join(import.meta.dir, "safe-log-write.ts"))};
process.stdin.once("data", async () => {
  for (let i = 0; i < 50; i++) {
    writeLogLine("GET /session-inbox 200 1ms\\n");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  process.stderr.write("OK\\n");
  process.exit(0);
});
`);
  const child = spawn("node", [script], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.stdout.destroy();
  child.stdin.write("start\n");
  const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
  expect(stderr).not.toContain("EPIPE");
  expect(stderr).toContain("OK");
  expect(code).toBe(0);
});
