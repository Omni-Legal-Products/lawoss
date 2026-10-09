import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const regression = fileURLToPath(new URL("./packaged-startup-regression.mjs", import.meta.url));

function killIfRunning(pid) {
  try { process.kill(pid, "SIGKILL"); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}

test("packaged startup cleanup preserves an early exit diagnostic after close already fired", { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "packaged-early-exit-test-"));
  const fixture = path.join(directory, "early-exit.mjs");
  const profileFile = path.join(directory, "profile.txt");
  await writeFile(fixture, `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(process.env.CLEANUP_TEST_PROFILE_FILE, process.env.LEGALWORK_ELECTRON_USERDATA);
console.error("synthetic early exit");
process.exit(42);
`);
  await chmod(fixture, 0o755);
  // Windows cannot execute a shebang fixture. Node without arguments and with
  // ignored stdin is an equally inert executable that exits immediately with 0.
  const target = process.platform === "win32" ? process.execPath : fixture;
  const runner = spawn(process.execPath, [regression, target], {
    detached: process.platform !== "win32",
    env: { ...process.env, CLEANUP_TEST_PROFILE_FILE: profileFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "", deadline;
  runner.stdout.on("data", chunk => { output += chunk; });
  runner.stderr.on("data", chunk => { output += chunk; });
  try {
    const result = await Promise.race([
      new Promise((resolve, reject) => {
        runner.once("error", reject);
        runner.once("close", (code, signal) => resolve({ code, signal }));
      }),
      new Promise(resolve => { deadline = setTimeout(() => resolve({ timedOut: true }), 10_000); }),
    ]);
    assert.equal(result.timedOut, undefined, output);
    assert.equal(result.code, 1, `Preserve the startup error, not exit 13 from an unsettled await.\n${output}`);
    assert.match(output, new RegExp(`Packaged app exited early: ${process.platform === "win32" ? 0 : 42}`));
    assert.doesNotMatch(output, /unsettled top-level await/);
    if (process.platform !== "win32") {
      assert.match(output, /synthetic early exit/);
      const userData = await readFile(profileFile, "utf8");
      await assert.rejects(stat(path.dirname(userData)), { code: "ENOENT" });
    }
  } finally {
    clearTimeout(deadline);
    killIfRunning(process.platform === "win32" ? runner.pid : -runner.pid);
    runner.stdout.destroy(); runner.stderr.destroy();
    // Also remove leaked synthetic profiles when checking the pre-fix runner.
    const userData = await readFile(profileFile, "utf8").catch(() => "");
    if (userData) await rm(path.dirname(userData), { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test("packaged startup cleanup terminates descendants holding output pipes open", {
  skip: process.platform === "win32" ? "POSIX process-group regression" : false,
  timeout: 20_000,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "packaged-cleanup-test-"));
  const fixture = path.join(directory, "fake-app.mjs");
  const pidFile = path.join(directory, "descendant.pid");
  await writeFile(fixture, `#!${process.execPath}
import { spawn } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
const orphan = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'], { stdio: ["ignore", "inherit", "inherit"] });
writeFileSync(process.env.CLEANUP_TEST_PID_FILE, String(orphan.pid));
const server = http.createServer((_request, response) => {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ ok: true, actions: [] }));
});
server.listen(0, "127.0.0.1", () => {
  writeFileSync(path.join(process.env.LEGALWORK_ELECTRON_USERDATA, "legalwork-ui-control.json"), JSON.stringify({ baseUrl: "http://127.0.0.1:" + server.address().port, token: "fixture-token" }));
  chmodSync(path.join(process.env.LEGALWORK_ELECTRON_USERDATA, "legalwork-ui-control.json"), 0o600);
});
`);
  await chmod(fixture, 0o755);
  const runner = spawn(process.execPath, [regression, fixture], {
    detached: true,
    env: { ...process.env, CLEANUP_TEST_PID_FILE: pidFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  runner.stdout.on("data", chunk => { output += chunk; });
  runner.stderr.on("data", chunk => { output += chunk; });
  let deadline;
  try {
    const result = await Promise.race([
      new Promise((resolve, reject) => {
        runner.once("error", reject);
        runner.once("close", (code, signal) => resolve({ code, signal }));
      }),
      new Promise(resolve => { deadline = setTimeout(() => resolve({ timedOut: true }), 12_000); }),
    ]);
    assert.equal(result.timedOut, undefined, `Cleanup must finish after PASS instead of retaining descendant pipes.\n${output}`);
    assert.equal(result.code, 0, output);
    assert.match(output, /PASS: packaged app and renderer/);
  } finally {
    clearTimeout(deadline);
    killIfRunning(-runner.pid);
    const descendant = Number(await readFile(pidFile, "utf8").catch(() => ""));
    if (descendant) killIfRunning(descendant);
    runner.stdout.destroy();
    runner.stderr.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
