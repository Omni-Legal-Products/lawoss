import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { copyAcceptedArchive, readRawRepresentation, writeProjectedRepresentation, verifyProjectedRepresentation, verifyPacoteRepresentation, operationScope } from "./native-merged-projection-cache.mjs";
import { FIXTURE_ACCEPT } from "./native-merged-cache-projection.mjs";
const physical = await fs.realpath(new URL("../../apps/desktop/resources/engine-dependencies/runtime-tools/node_modules", import.meta.url));
const root = createRequire(new URL("../../apps/desktop/resources/engine-dependencies/runtime-tools/package.json", import.meta.url));
async function admit(require, name, version) {
  const manifest = await fs.realpath(require.resolve(name + "/package.json")), entry = await fs.realpath(require.resolve(name));
  for (const file of [manifest, entry]) {
    const relative = path.relative(physical, file);
    assert.ok(relative && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
  }
  const pkg = JSON.parse(await fs.readFile(manifest));
  assert.equal(pkg.name, name);
  assert.equal(pkg.version, version);
  assert.ok(entry.startsWith(path.dirname(manifest) + path.sep));
  return { require: createRequire(entry), api: require(name) };
}
const ar = await admit(root, "@npmcli/arborist", "9.4.0");
const p = await admit(ar.require, "pacote", "21.5.1");
const r = await admit(p.require, "npm-registry-fetch", "19.1.1");
const f = await admit(r.require, "make-fetch-happen", "15.0.6");
const c = await admit(ar.require, "cacache", "20.0.4");
const pacote = p.api, fetch = f.api, cacache = c.api;
const record = { name: "fixture-inert", version: "1.0.0", escapedName: "fixture-inert" };
const value = (n) => ({ name: record.name, versions: { "1.0.0": { name: record.name, version: "1.0.0", mark: n } }, "dist-tags": { latest: "1.0.0" } });
async function setup(t) {
  const cache = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "projection-cache-"));
  t.after(() => fs.rm(cache, { recursive: true, force: true }));
  const scope = operationScope(Date.now() + 5000);
  t.after(() => scope.dispose());
  return { cache, scope };
}
test("actual pinned public put preserves both offline variants in either insertion order", async (t) => {
  for (const order of [[0, 1], [1, 0]]) {
    const { cache, scope } = await setup(t);
    const bodies = [Buffer.from(JSON.stringify(value("full"))), Buffer.from(JSON.stringify(value("corgi")))];
    for (const i of order)
      await writeProjectedRepresentation({ cacache, cache, record, accept: FIXTURE_ACCEPT[i], bytes: bodies[i], rawBodySha256: "a".repeat(64), scope });
    for (const i of [0, 1]) {
      await verifyProjectedRepresentation({ fetch, cache, record, accept: FIXTURE_ACCEPT[i], expected: bodies[i], scope });
      await verifyPacoteRepresentation({ pacote, cache, record, fullMetadata: i === 0, expected: bodies[i], scope });
    }
    scope.dispose();
  }
});
test("missing representation and wrong exact byte candidate refuse", async (t) => {
  const { cache, scope } = await setup(t);
  const bytes = Buffer.from(JSON.stringify(value("full")));
  await writeProjectedRepresentation({ cacache, cache, record, accept: FIXTURE_ACCEPT[0], bytes, rawBodySha256: "a".repeat(64), scope });
  await assert.rejects(verifyProjectedRepresentation({ fetch, cache, record, accept: FIXTURE_ACCEPT[1], expected: bytes, scope }));
  await assert.rejects(verifyProjectedRepresentation({ fetch, cache, record, accept: FIXTURE_ACCEPT[0], expected: Buffer.from("{}"), scope }));
  scope.dispose();
});
test("pending public put settles after cancellation; late rejection preserves CANCELLED primary", async () => {
  const controller = new AbortController;
  const scope = operationScope(Date.now() + 5000, controller.signal);
  let rejectPut;
  const pending = new Promise((_, r) => {
    rejectPut = r;
  });
  const op = writeProjectedRepresentation({ cacache: { put: () => pending }, cache: "/unused", record, accept: FIXTURE_ACCEPT[0], bytes: Buffer.from("{}"), rawBodySha256: "a".repeat(64), scope });
  controller.abort();
  let settled = false;
  op.finally(() => {
    settled = true;
  }).catch(() => {});
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false);
  rejectPut(Error("private transport text"));
  await assert.rejects(op, { code: "CANCELLED" });
  scope.dispose();
});
import { createHash } from "node:crypto";
import { snapshotCache } from "./native-merged-projection-files.mjs";
const sri = (bytes) => "sha512-" + createHash("sha512").update(bytes).digest("base64");
test("actual accepted-key archive copy verifies SRI, index insertion and untouched raw bytes", async (t) => {
  const { cache: raw, scope } = await setup(t);
  const scratch = raw + "-scratch", derived = raw + "-derived";
  t.after(() => fs.rm(scratch, { recursive: true, force: true }));
  t.after(() => fs.rm(derived, { recursive: true, force: true }));
  const body = Buffer.from("inert-not-an-installable-archive");
  const r = { name: "fixture-inert", version: "1.0.0", resolved: "https://registry.npmjs.org/fixture-inert/-/fixture-inert-1.0.0.tgz", integrity: sri(body) };
  await cacache.put(raw, "lawoss:accepted:" + r.resolved, body, { integrity: r.integrity });
  const before = await snapshotCache(raw);
  await fs.cp(raw, scratch, { recursive: true });
  const result = await copyAcceptedArchive({ cacache, source: scratch, destination: derived, record: r, scope });
  assert.equal(result.bytes, body.length);
  assert.equal((await cacache.get.info(derived, "lawoss:accepted:" + r.resolved)).integrity, r.integrity);
  assert.deepEqual((await snapshotCache(raw)).inventory, before.inventory);
  scope.dispose();
});
test("actual missing archive key and wrong SRI refuse without substituting content by digest", async (t) => {
  const { cache, scope } = await setup(t);
  const body = Buffer.from("inert");
  const r = { ...record, resolved: "https://registry.npmjs.org/fixture-inert/-/fixture-inert-1.0.0.tgz", integrity: sri(body) };
  await cacache.put(cache, "wrong-key", body, { integrity: r.integrity });
  await assert.rejects(copyAcceptedArchive({ cacache, source: cache, destination: cache + "-unused", record: r, scope }));
  await cacache.put(cache, "lawoss:accepted:" + r.resolved, body, { integrity: r.integrity });
  await assert.rejects(copyAcceptedArchive({ cacache, source: cache, destination: cache + "-unused", record: { ...r, integrity: sri(Buffer.from("other")) }, scope }));
  scope.dispose();
});
test("a fulfilled put with missing archive index still refuses", async () => {
  const body = Buffer.from("inert"), r = { ...record, resolved: "https://registry.npmjs.org/fixture-inert/-/fixture-inert-1.0.0.tgz", integrity: sri(body) }, scope = operationScope(Date.now() + 5000);
  const { Readable } = await import("node:stream");
  const api = { put: async () => r.integrity, get: { info: async (cache) => cache === "source" ? { key: "lawoss:accepted:" + r.resolved, integrity: r.integrity, size: body.length } : null, stream: { byDigest: () => Readable.from([body]) } } };
  await assert.rejects(copyAcceptedArchive({ cacache: api, source: "source", destination: "derived", record: r, scope }), { code: "PROJECTION_READBACK" });
  scope.dispose();
});
test("actual corrupted metadata content never accepts its uncorrupted sibling as proof", async (t) => {
  const { cache, scope } = await setup(t);
  const full = Buffer.from(JSON.stringify(value("full"))), corgi = Buffer.from(JSON.stringify(value("corgi")));
  for (const [i, bytes] of [[0, full], [1, corgi]])
    await writeProjectedRepresentation({ cacache, cache, record, accept: FIXTURE_ACCEPT[i], bytes, rawBodySha256: "a".repeat(64), scope });
  const hex = createHash("sha512").update(full).digest("hex");
  await fs.writeFile(path.join(cache, "content-v2/sha512", hex.slice(0, 2), hex.slice(2, 4), hex.slice(4)), "corrupted");
  await assert.rejects(verifyProjectedRepresentation({ fetch, cache, record, accept: FIXTURE_ACCEPT[0], expected: full, scope }));
  scope.dispose();
});
test("late response after cancellation is destroyed and body completion is joined", async () => {
  const { Readable } = await import("node:stream");
  const controller = new AbortController, scope = operationScope(Date.now() + 5000, controller.signal);
  let deliver;
  const response = new Promise((resolve) => deliver = resolve);
  const op = readRawRepresentation({ fetch: () => response, cache: "/unused", record, accept: FIXTURE_ACCEPT[0], scope });
  controller.abort();
  const body = Readable.from([Buffer.from("private")]);
  deliver({ status: 200, body });
  await assert.rejects(op, { code: "CANCELLED" });
  assert.equal(body.destroyed, true);
  scope.dispose();
});
test("cancellation before put fulfillment forbids subsequent writes", async () => {
  const controller = new AbortController, scope = operationScope(Date.now() + 5000, controller.signal);
  let finish, writes = 0;
  const pending = new Promise((resolve) => finish = resolve), api = { put: () => {
    writes++;
    return pending;
  } };
  const args = { cacache: api, cache: "/unused", record, accept: FIXTURE_ACCEPT[0], bytes: Buffer.from("{}"), rawBodySha256: "a".repeat(64), scope };
  const first = writeProjectedRepresentation(args);
  controller.abort();
  finish();
  await assert.rejects(first, { code: "CANCELLED" });
  await assert.rejects(writeProjectedRepresentation(args), { code: "CANCELLED" });
  assert.equal(writes, 1);
  scope.dispose();
});
import { fixtureCacheKey, fixtureCacheMetadata } from "./native-merged-cache-projection.mjs";
test("actual wrong Accept, compression metadata and URL key cannot supply exact byte proof", async (t) => {
  for (const mode of ["accept", "compress", "key"]) {
    const { cache, scope } = await setup(t), bytes = Buffer.from(JSON.stringify(value("full"))), url = "https://registry.npmjs.org/fixture-inert", metadata = fixtureCacheMetadata({ url, accept: FIXTURE_ACCEPT[0], rawBodySha256: "a".repeat(64) });
    if (mode === "compress")
      metadata.options.compress = false;
    await cacache.put(cache, mode === "key" ? "wrong-key" : fixtureCacheKey(url), bytes, { integrity: sri(bytes), time: 1, metadata });
    await assert.rejects(verifyProjectedRepresentation({ fetch, cache, record, accept: mode === "accept" ? "application/xml" : FIXTURE_ACCEPT[0], expected: bytes, scope }));
  }
});
