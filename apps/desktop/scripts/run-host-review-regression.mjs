// Chromium owns profile files until Electron exits. The Node parent alone
// creates/removes the test profile, as in run-preview-security.mjs.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

export async function runHostReviewSmoke({binary = electron, script = fileURLToPath(new URL("host-review-regression.mjs", import.meta.url)), timeoutMs = 60000} = {}) {
  const userData = await mkdtemp(path.join(tmpdir(), "legalwork-host-review-"));
  let primary, timer;
  try {
    const child = spawn(binary, [script], {env: {...process.env, LEGALWORK_HOST_REVIEW_USERDATA: userData}, stdio: "inherit"});
    let timedOut = false;
    timer = setTimeout(() => {timedOut = true; child.kill("SIGKILL");}, timeoutMs);
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({code, signal}));
    });
    if (timedOut) throw new Error("Host review Electron smoke timed out");
    if (result.code !== 0) throw new Error(`Host review Electron smoke exited ${result.code ?? result.signal}`);
  } catch (error) {primary = error;}
  finally {
    clearTimeout(timer);
    try {await rm(userData, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});}
    catch (error) {if (primary) throw new AggregateError([primary, error], "Host review smoke and owned profile cleanup failed"); throw error;}
  }
  if (primary) throw primary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runHostReviewSmoke().catch(error => {console.error(error); process.exitCode = 1;});
}
