import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectNativeCache } from "./native-merged-cache-projection-worker.mjs";
const worker = fileURLToPath(new URL("./native-merged-cache-projection-worker.mjs", import.meta.url));
const node22 = fileURLToPath(new URL("../../apps/desktop/resources/node/node", import.meta.url));
async function child(args) {
  return new Promise((resolve) => {
    const c = spawn(node22, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    c.stdout.on("data", (b) => stdout += b);
    c.stderr.on("data", (b) => stderr += b);
    c.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}
test("API refuses actual wrong runtime before filesystem work", async () => {
  await assert.rejects(projectNativeCache("/does-not-exist", Date.now() + 1000), { code: "NODE_VERSION" });
});
test("actual pinned Node22 worker refuses missing nonconfigurable network guard with closed finite JSON", async () => {
  const result = await child([worker, "/does-not-exist", String(Date.now() + 1000)]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.equal(JSON.parse(result.stderr).code, "PROJECTION_NETWORK_GUARD");
  assert.ok(!result.stderr.includes("does-not-exist"));
});
test("actual pinned Node22 guarded worker refuses original deadline without renewing it", async () => {
  const guard = fileURLToPath(new URL("../build/plugin-payload/network-guard.mjs", import.meta.url));
  for (const deadline of [0, Date.now() + 310000]) {
    const result = await child(["--import", guard, worker, "/does-not-exist", String(deadline)]);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, "PRIMER_DEADLINE");
  }
});
import * as fs from "node:fs/promises";
import os from "node:os";
import { initialize, runChild } from "../build/plugin-payload/prepare.mjs";
import { canonicalRecordBytes, sha256 } from "./native-merged-projection-contract.mjs";
import { ACCEPTED } from "../build/plugin-payload/prime-cache.mjs";
import { RUNTIME_LOCK, VERSIONS } from "./native-merged-cache-worker.mjs";
async function owned(t) {
  const parent = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "projection-worker-"));
  const workspace = path.join(parent, "workspace");
  await initialize(workspace);
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  return workspace;
}
async function ready(workspace) {
  const end = Date.now() + 3000;
  while (!await fs.stat(path.join(workspace, "projection-child-ready")).catch(() => null)) {
    if (Date.now() > end)
      throw Error("child readiness");
    await new Promise((r) => setTimeout(r, 5));
  }
}
function request(deadline) {
  const rawAcquisition = { schema: 1, phase: "acquisition", status: "complete", ...ACCEPTED, runtimeLockSha256: RUNTIME_LOCK, node: "v22.23.2", platform: process.platform, versions: VERSIONS, tarballs: 32, names: 32, metadata: 64, offline: 64, archiveBytes: 32, metadataBytes: 64 };
  return { schema: 1, policy: "accepted-version-fixture-v1", nonce: "12345678-1234-4234-8234-123456789abc", deadline, rawAcquisition, rawAcquisitionSha256: sha256(canonicalRecordBytes(rawAcquisition)), sourceInventorySha256: "a".repeat(64) };
}
test("actual guarded worker refuses altered original acquisition pins and retains original receipt", async (t) => {
  const workspace = await owned(t), deadline = Date.now() + 5000, row = request(deadline);
  row.rawAcquisition.lockSha256 = "a".repeat(64);
  row.rawAcquisitionSha256 = sha256(canonicalRecordBytes(row.rawAcquisition));
  await fs.writeFile(path.join(workspace, "native-projection-input.json"), canonicalRecordBytes(row));
  await fs.writeFile(path.join(workspace, "native-operation.json"), "original-raw-receipt");
  await assert.rejects(runChild([worker, workspace, String(deadline)], workspace, { executable: node22 }), (error) => error.code === "RECEIPT_INVALID" && error.child.closed === true);
  assert.equal(await fs.readFile(path.join(workspace, "native-operation.json"), "utf8"), "original-raw-receipt");
  const fail = JSON.parse(await fs.readFile(path.join(workspace, "native-projection-operation.json")));
  assert.equal(fail.nonce, null);
  assert.equal(fail.drain, "settled");
});
test("actual guarded worker rejects source tools absent in this checkout without packaged-tree fallback", async (t) => {
  const workspace = await owned(t), deadline = Date.now() + 5000;
  await fs.writeFile(path.join(workspace, "native-projection-input.json"), canonicalRecordBytes(request(deadline)));
  await assert.rejects(runChild([worker, workspace, String(deadline)], workspace, { executable: node22 }), (error) => error.code === "TOOLS_INVALID" && error.child.closed === true);
  await assert.rejects(fs.access(path.join(workspace, "accepted-fixture")), { code: "ENOENT" });
});
test("stdout emitted before close never releases supervisor result or ownership", async (t) => {
  const workspace = await owned(t), fixture = fileURLToPath(new URL("./fixtures/native-merged-projection-child.mjs", import.meta.url));
  let settled = false;
  const pending = runChild([fixture, "success", workspace], workspace, { executable: node22 }).finally(() => {
    settled = true;
  });
  await ready(workspace);
  assert.equal(settled, false);
  assert.deepEqual(await pending, { schema: 1, fixture: "emitted-before-close" });
  assert.equal(await fs.readFile(path.join(workspace, "projection-child-settled"), "utf8"), "settled-before-close");
});
test("signal cancellation joins actual child close before owned final-write evidence is read", async (t) => {
  const workspace = await owned(t), fixture = fileURLToPath(new URL("./fixtures/native-merged-projection-child.mjs", import.meta.url)), controller = new AbortController;
  const pending = runChild([fixture, "cancel", workspace], workspace, { executable: node22, signal: controller.signal });
  await ready(workspace);
  controller.abort();
  await assert.rejects(pending, (error) => error.code === "CANCELLED" && error.child.closed === true);
  if (process.platform !== "win32")
    assert.equal(await fs.readFile(path.join(workspace, "projection-child-settled"), "utf8"), "settled-before-close");
});
