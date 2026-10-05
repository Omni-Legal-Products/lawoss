import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const regression = fileURLToPath(new URL("./packaged-startup-regression.mjs", import.meta.url));

function killIfRunning(pid) {
  try { process.kill(pid, "SIGKILL"); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}

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
