import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { snapshotCache, copyCacheSnapshot, readBoundedRecord, writeExclusiveRecord, sourceInventory, stableRead } from "./native-merged-projection-files.mjs";
const leaf = "content-v2/sha512/aa/bb/" + "c".repeat(124);
async function cache(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "projection-files-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const raw = path.join(root, "raw");
  await fs.mkdir(path.dirname(path.join(raw, leaf)), { recursive: true });
  await fs.writeFile(path.join(raw, leaf), "inert");
  return { root, raw };
}
test("stable cache copy preserves exact bytes with physically independent single-link files", async (t) => {
  const { root, raw } = await cache(t);
  const before = await snapshotCache(raw);
  const copy = await copyCacheSnapshot(raw, path.join(root, "scratch"), before);
  assert.deepEqual(copy.inventory, before.inventory);
  assert.notEqual(copy.files[0].stat.ino, before.files[0].stat.ino);
  assert.deepEqual((await snapshotCache(raw)).inventory, before.inventory);
});
test("unknown layout, nonempty tmp, hardlinks and symlinks refuse without deleting", async (t) => {
  for (const kind of ["unknown", "tmp", "link", "symlink"]) {
    const { raw } = await cache(t);
    const file = path.join(raw, leaf);
    if (kind === "unknown")
      await fs.writeFile(path.join(raw, "alien"), "x");
    if (kind === "tmp") {
      await fs.mkdir(path.join(raw, "tmp"));
      await fs.writeFile(path.join(raw, "tmp/a"), "x");
    }
    if (kind === "link")
      await fs.link(file, path.join(path.dirname(file), "d".repeat(124)));
    if (kind === "symlink")
      await fs.symlink(file, path.join(raw, "tmp"));
    await assert.rejects(snapshotCache(raw));
    assert.equal(await fs.readFile(file, "utf8"), "inert");
  }
});
test("preexisting destination and overlapping source refuse without adoption", async (t) => {
  const { raw } = await cache(t);
  const s = await snapshotCache(raw);
  await assert.rejects(copyCacheSnapshot(raw, raw, s));
  await assert.rejects(copyCacheSnapshot(raw, path.join(raw, "scratch"), s));
});
test("bounded canonical records are exclusive and reject whitespace, oversize and hardlinks", async (t) => {
  const { root } = await cache(t);
  const file = path.join(root, "record");
  await writeExclusiveRecord(file, { b: 2, a: 1 }, 1024);
  assert.equal((await fs.stat(file)).mode & 511, 384);
  assert.deepEqual(await readBoundedRecord(file, 1024), { a: 1, b: 2 });
  await assert.rejects(writeExclusiveRecord(file, {}, 1024));
  await fs.writeFile(file, "{}");
  await assert.rejects(readBoundedRecord(file, 1024));
  await fs.writeFile(file, "x".repeat(1025));
  await assert.rejects(readBoundedRecord(file, 1024));
});
test("stable descriptor reads refuse linked ancestors and stale snapshot file growth", async (t) => {
  const { root, raw } = await cache(t);
  await fs.symlink(raw, path.join(root, "alias"));
  await assert.rejects(stableRead(path.join(root, "alias", leaf), 64));
  const snapshot = await snapshotCache(raw);
  await fs.appendFile(path.join(raw, leaf), "more");
  await assert.rejects(copyCacheSnapshot(raw, path.join(root, "copy"), snapshot));
});
test("fixed source fingerprint refuses missing source tool tree without loading or falling back to packaged tools", async () => {
  await assert.rejects(sourceInventory(), { code: "TOOLS_INVALID" });
});
import mutableFS from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { operationScope } from "./native-merged-projection-cache.mjs";
// Isolated built-in interception models descriptor delays/failures; real files
// supply data/identity. Always restore the original own property descriptor.
async function interceptOpen(t, wrap) {
  const descriptor = Object.getOwnPropertyDescriptor(mutableFS, "open");
  Object.defineProperty(mutableFS, "open", { ...descriptor, value: async (...args) => wrap(await descriptor.value(...args)) });
  syncBuiltinESMExports();
  t.after(() => {
    Object.defineProperty(mutableFS, "open", descriptor);
    syncBuiltinESMExports();
  });
}
test("cancelled pending open still closes the descriptor before rejecting", async (t) => {
  const { root } = await cache(t);
  const file = path.join(root, "inert");
  await fs.writeFile(file, "abc");
  const controller = new AbortController, scope = operationScope(Date.now() + 5000, controller.signal);
  t.after(() => scope.dispose());
  let opened, release, closed = false;
  const started = new Promise((resolve) => opened = resolve), held = new Promise((resolve) => release = resolve);
  await interceptOpen(t, async (handle) => {
    const original = handle.close.bind(handle);
    handle.close = async () => {
      closed = true;
      return original();
    };
    opened();
    await held;
    return handle;
  });
  const pending = stableRead(file, 64, { scope });
  await started;
  controller.abort();
  release();
  await assert.rejects(pending, { code: "CANCELLED" });
  assert.equal(closed, true);
});
test("descriptor close failure refuses a read, preserving earlier read failure privately", async (t) => {
  const { root } = await cache(t);
  const file = path.join(root, "inert");
  await fs.writeFile(file, "abc");
  const closeError = Error("private-close");
  await interceptOpen(t, (handle) => {
    const original = handle.close.bind(handle);
    handle.close = async () => {
      await original();
      throw closeError;
    };
    return handle;
  });
  await assert.rejects(stableRead(file, 64), (error) => error === closeError);
});
test("descriptor-time growth and same inode rounding beyond 2^53 are observed as drift", async (t) => {
  const { root } = await cache(t);
  const file = path.join(root, "inert");
  await fs.writeFile(file, "abc");
  await interceptOpen(t, (handle) => {
    const original = handle.stat.bind(handle);
    handle.stat = async (...args) => {
      const stat = await original(...args);
      return new Proxy(stat, { get(target, key) {
        return key === "ino" ? 9007199254740993n : Reflect.get(target, key);
      } });
    };
    return handle;
  });
  await assert.rejects(stableRead(file, 64), { code: "INPUT_DRIFT" });
});
test("sparse oversized content and oversized index refuse before body allocation", async (t) => {
  for (const [relative, size] of [[leaf, 64 * 1024 * 1024 + 1], ["index-v5/aa/bb/" + "d".repeat(60), 262145]]) {
    const { raw } = await cache(t);
    await fs.mkdir(path.dirname(path.join(raw, relative)), { recursive: true });
    const h = await fs.open(path.join(raw, relative), "w");
    await h.truncate(size);
    await h.close();
    await assert.rejects(snapshotCache(raw), { code: "PROJECTION_LIMIT" });
  }
});
test("canonical record readers reject duplicate keys, wrong LF and hardlinked records", async (t) => {
  const { root } = await cache(t);
  const file = path.join(root, "record");
  for (const bytes of [`{"a":1,"a":1}
`, `{}

`, `{}\r
`]) {
    await fs.writeFile(file, bytes);
    await assert.rejects(readBoundedRecord(file, 4096));
  }
  await fs.writeFile(file, `{}
`);
  await fs.link(file, path.join(root, "alias"));
  await assert.rejects(readBoundedRecord(file, 4096));
});
import { verifyProjectionArtifacts } from "./native-merged-projection-files.mjs";
import { initialize } from "../build/plugin-payload/prepare.mjs";
import { ACCEPTED } from "../build/plugin-payload/prime-cache.mjs";
import { RUNTIME_LOCK, VERSIONS } from "./native-merged-cache-worker.mjs";
import { canonicalRecordBytes, sha256, COUNTS } from "./native-merged-projection-contract.mjs";
test("post-close content verifier refuses caller close booleans, missing and partial manifests", async (t) => {
  const { root } = await cache(t), workspace = path.join(root, "workspace");
  await initialize(workspace);
  const rawAcquisition = { schema: 1, phase: "acquisition", status: "complete", ...ACCEPTED, runtimeLockSha256: RUNTIME_LOCK, node: "v22.23.2", platform: process.platform, versions: VERSIONS, tarballs: 32, names: 32, metadata: 64, offline: 64, archiveBytes: 32, metadataBytes: 64 };
  const request = { schema: 1, policy: "accepted-version-fixture-v1", nonce: "12345678-1234-4234-8234-123456789abc", deadline: Date.now() + 5000, rawAcquisition, rawAcquisitionSha256: sha256(canonicalRecordBytes(rawAcquisition)), sourceInventorySha256: "a".repeat(64) };
  const receipt = { schema: 1, phase: "projection", status: "complete", kind: "derived-accepted-version-fixture", policy: request.policy, nonce: request.nonce, requestSha256: sha256(canonicalRecordBytes(request)), rawAcquisitionSha256: request.rawAcquisitionSha256, sourceInventorySha256: request.sourceInventorySha256, manifestSha256: "a".repeat(64), rawCacheSha256: "a".repeat(64), derivedCacheSha256: "a".repeat(64), node: "v22.23.2", platform: process.platform, ...COUNTS, archiveBytes: 32, rawMetadataBytes: 64, projectedMetadataBytes: 64 };
  await assert.rejects(verifyProjectionArtifacts(workspace, receipt, request, [], { closed: true }), { code: "RECEIPT_INVALID" });
  await writeExclusiveRecord(path.join(workspace, "native-projection-input.json"), request, 4096);
  await fs.mkdir(path.join(workspace, "accepted-fixture"));
  await writeExclusiveRecord(path.join(workspace, "accepted-fixture/.owner.json"), { schema: 1, nonce: request.nonce, workspace: { dev: "1", ino: "2" }, root: { dev: "1", ino: "3" } }, 1024);
  await assert.rejects(verifyProjectionArtifacts(workspace, receipt, request, []));
  await fs.writeFile(path.join(workspace, "accepted-fixture/manifest.json"), "{");
  await assert.rejects(verifyProjectionArtifacts(workspace, receipt, request, []), { code: "RECEIPT_INVALID" });
});
test("identical rounded inode Numbers conceal a real BigInt fd identity change and must refuse", async (t) => {
  const { root } = await cache(t), file = path.join(root, "big-inode");
  await fs.writeFile(file, "abc");
  const descriptor = Object.getOwnPropertyDescriptor(mutableFS, "lstat");
  const fake = (stat, ino) => new Proxy(stat, { get(target, key) {
    return key === "ino" ? ino : Reflect.get(target, key);
  } });
  Object.defineProperty(mutableFS, "lstat", { ...descriptor, value: async (...args) => {
    const stat = await descriptor.value(...args);
    return args[0] === file ? fake(stat, 9007199254740992n) : stat;
  } });
  syncBuiltinESMExports();
  t.after(() => {
    Object.defineProperty(mutableFS, "lstat", descriptor);
    syncBuiltinESMExports();
  });
  await interceptOpen(t, (handle) => {
    const original = handle.stat.bind(handle);
    let calls = 0;
    handle.stat = async (...args) => fake(await original(...args), calls++ === 0 ? 9007199254740992n : 9007199254740993n);
    return handle;
  });
  assert.equal(Number(9007199254740992n), Number(9007199254740993n));
  await assert.rejects(stableRead(file, 64), { code: "INPUT_DRIFT" });
});
test("file growth during descriptor consumption preserves primary refusal plus close error", async (t) => {
  const { root } = await cache(t), file = path.join(root, "grow");
  await fs.writeFile(file, "abc");
  const closeError = Error("private-close");
  await interceptOpen(t, (handle) => {
    const read = handle.read.bind(handle), close = handle.close.bind(handle);
    let first = true;
    handle.read = async (...args) => {
      if (first) {
        first = false;
        await fs.appendFile(file, "extra");
      }
      return read(...args);
    };
    handle.close = async () => {
      await close();
      throw closeError;
    };
    return handle;
  });
  await assert.rejects(stableRead(file, 64), (error) => error.code === "PROJECTION_LIMIT" && error.closeError === closeError);
});
test("exclusive record write failure joins close and retains both original errors", async (t) => {
  const { root } = await cache(t), writeError = Error("private-write"), closeError = Error("private-close");
  let closed = false;
  await interceptOpen(t, (handle) => {
    const close = handle.close.bind(handle);
    handle.writeFile = async () => {
      throw writeError;
    };
    handle.close = async () => {
      closed = true;
      await close();
      throw closeError;
    };
    return handle;
  });
  await assert.rejects(writeExclusiveRecord(path.join(root, "failed"), {}, 1024), (error) => error === writeError && error.closeError === closeError);
  assert.equal(closed, true);
});
test("same-byte destination replacement after copied descriptor close is unknown adoption and refuses", async (t) => {
  const { root, raw } = await cache(t), destination = path.join(root, "replacement-copy"), target = path.join(destination, leaf);
  const snapshot = await snapshotCache(raw);
  const descriptor = Object.getOwnPropertyDescriptor(mutableFS, "open");
  Object.defineProperty(mutableFS, "open", { ...descriptor, value: async (...args) => {
    const handle = await descriptor.value(...args);
    if (args[0] === target && args[1] === "wx") {
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        const backup = path.join(root, "created-copy-before-replacement");
        await fs.rename(target, backup);
        await fs.copyFile(backup, target);
      };
    }
    return handle;
  } });
  syncBuiltinESMExports();
  t.after(() => {
    Object.defineProperty(mutableFS, "open", descriptor);
    syncBuiltinESMExports();
  });
  await assert.rejects(copyCacheSnapshot(raw, destination, snapshot), { code: "INPUT_DRIFT" });
});
test("same-byte published record replacement cannot inherit the exclusive descriptor authority", async (t) => {
  const { root } = await cache(t), file = path.join(root, "publish");
  const descriptor = Object.getOwnPropertyDescriptor(mutableFS, "open");
  Object.defineProperty(mutableFS, "open", { ...descriptor, value: async (...args) => {
    const handle = await descriptor.value(...args);
    if (args[0] === file && args[1] === "wx") {
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        const backup = path.join(root, "record-before-replacement");
        await fs.rename(file, backup);
        await fs.copyFile(backup, file);
      };
    }
    return handle;
  } });
  syncBuiltinESMExports();
  t.after(() => {
    Object.defineProperty(mutableFS, "open", descriptor);
    syncBuiltinESMExports();
  });
  await assert.rejects(writeExclusiveRecord(file, {}, 1024), { code: "INPUT_DRIFT" });
});
test("copy preserves one primary read failure and both descriptor-close failures", async (t) => {
  const { root, raw } = await cache(t), destination = path.join(root, "double-close"), snapshot = await snapshotCache(raw), primary = Object.assign(Error("private-read"), { code: "INPUT_DRIFT" }), sourceClose = Error("private-source-close"), destinationClose = Error("private-destination-close");
  let destinationOpened = false;
  const descriptor = Object.getOwnPropertyDescriptor(mutableFS, "open");
  Object.defineProperty(mutableFS, "open", { ...descriptor, value: async (...args) => {
    const handle = await descriptor.value(...args), close = handle.close.bind(handle);
    if (args[0] === path.join(destination, leaf) && args[1] === "wx") {
      destinationOpened = true;
      handle.close = async () => {
        await close();
        throw destinationClose;
      };
    } else if (destinationOpened && args[0] === path.join(raw, leaf)) {
      handle.read = async () => {
        throw primary;
      };
      handle.close = async () => {
        await close();
        throw sourceClose;
      };
    }
    return handle;
  } });
  syncBuiltinESMExports();
  t.after(() => {
    Object.defineProperty(mutableFS, "open", descriptor);
    syncBuiltinESMExports();
  });
  await assert.rejects(copyCacheSnapshot(raw, destination, snapshot), (error) => error === primary && error.closeErrors[0] === sourceClose && error.closeErrors[1] === destinationClose);
});
test("a settled close rejection remains a failed drain observation", async (t) => {
  const { root } = await cache(t), file = path.join(root, "close-drain"), scope = operationScope(Date.now() + 5000);
  t.after(() => scope.dispose());
  await fs.writeFile(file, "abc");
  await interceptOpen(t, (handle) => {
    const close = handle.close.bind(handle);
    handle.close = async () => {
      await close();
      throw Error("private-close");
    };
    return handle;
  });
  await assert.rejects(stableRead(file, 64, { scope }));
  assert.equal(await scope.drain(), "failed");
});
