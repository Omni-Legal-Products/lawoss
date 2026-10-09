import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MediaStore } from "../dist/media-store.js";
import { resolveWorkspacePath } from "../dist/path-scope.js";

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "router-media-security-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, "workspace"), outside = path.join(dir, "outside");
  await fs.mkdir(root); await fs.mkdir(outside);
  await fs.writeFile(path.join(root, "safe.txt"), "synthetic safe");
  await fs.writeFile(path.join(outside, "sentinel.txt"), "synthetic secret");
  const store = new MediaStore(path.join(root, "media"), root);
  return { dir, root, outside, store };
}

test("outbound attachments reject absolute and relative escapes independently of selected directory", async (t) => {
  const { root, outside, store } = await fixture(t);
  for (const filePath of [path.join(outside, "sentinel.txt"), "../outside/sentinel.txt"]) {
    await assert.rejects(store.resolveOutboundFile({ filePath, baseDirectory: root, workspaceRoot: root }), /within workspace root/);
  }
  await assert.rejects(store.resolveOutboundFile({ filePath: "sentinel.txt", baseDirectory: outside, workspaceRoot: root }), /within workspace root/);
  await assert.rejects(store.resolveOutboundFile({ filePath: "missing.txt", baseDirectory: root, workspaceRoot: root }), (error) => error.status === 404);
  for (const filePath of ["safe.txt", path.join(root, "safe.txt")]) {
    const result = await store.resolveOutboundFile({ filePath, baseDirectory: root, workspaceRoot: root });
    assert.equal(await fs.readFile(result.filePath, "utf8"), "synthetic safe");
  }
});

test("canonical scope rejects file and ancestor symlinks but accepts workspace aliases and internal links", async (t) => {
  const { dir, root, outside, store } = await fixture(t);
  await fs.symlink(outside, path.join(root, "escape"), "dir");
  await fs.symlink(path.join(outside, "sentinel.txt"), path.join(root, "escape.txt"));
  await fs.symlink(path.join(root, "safe.txt"), path.join(root, "internal.txt"));
  await fs.symlink(root, path.join(dir, "workspace-alias"), "dir");
  for (const filePath of ["escape/sentinel.txt", "escape.txt"]) {
    await assert.rejects(store.resolveOutboundFile({ filePath, baseDirectory: root, workspaceRoot: root }), /within workspace root/);
  }
  await assert.rejects(store.resolveOutboundFile({ filePath: "sentinel.txt", baseDirectory: path.join(root, "escape"), workspaceRoot: root }), /within workspace root/);
  const result = await store.resolveOutboundFile({ filePath: "internal.txt", baseDirectory: path.join(dir, "workspace-alias"), workspaceRoot: root });
  assert.equal(await fs.readFile(result.filePath, "utf8"), "synthetic safe");
  assert.throws(() => resolveWorkspacePath(root, path.join(root, "escape", "new-dir", "file.txt"), true), /within workspace root/);
});

test("inbound media cannot write through an external media directory symlink", async (t) => {
  const { root, outside, store } = await fixture(t);
  await fs.symlink(outside, path.join(root, "media"), "dir");
  await assert.rejects(store.ensureReady(), /within workspace root/);
  await assert.rejects(store.saveInboundBuffer({ channel: "test", identityId: "test", peerId: "test", kind: "file", filename: "sentinel.txt", buffer: new Uint8Array([1, 2]) }), /within workspace root/);
  assert.deepEqual(await fs.readdir(outside), ["sentinel.txt"]);
  assert.equal(await fs.readFile(path.join(outside, "sentinel.txt"), "utf8"), "synthetic secret");
});

test("legitimate inbound repeated filenames remain separate private files", async (t) => {
  const { store } = await fixture(t);
  await store.ensureReady();
  const input = { channel: "test", identityId: "test", peerId: "test", kind: "file", filename: "report.txt", buffer: new Uint8Array([1, 2]) };
  const first = await store.saveInboundBuffer(input), second = await store.saveInboundBuffer(input);
  assert.notEqual(first.filePath, second.filePath);
  assert.equal(first.filename, "report.txt");
  assert.deepEqual(await fs.readFile(first.filePath), Buffer.from([1, 2]));
  if (process.platform !== "win32") assert.equal((await fs.stat(first.filePath)).mode & 0o777, 0o600);
});
