import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createUpdaterPreferences, UPDATER_PREFERENCES_FILENAME } from "./updater-preferences.mjs";

async function fixture(t, existing = false) {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-updater-preferences-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (existing) await mkdir(path.join(root, "Local Storage"));
  const app = { getPath: () => root };
  return { root, app, filename: path.join(root, UPDATER_PREFERENCES_FILENAME), store: createUpdaterPreferences(app) };
}

test("a genuinely fresh profile preserves the existing update defaults", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.store.read(), { autoCheck: true, autoDownload: false });
  assert.deepEqual(JSON.parse(await readFile(f.filename, "utf8")), { autoCheck: true, autoDownload: false });
});
test("migrates explicit browser preferences, then survives browser storage loss and stale values", async t => {
  const f = await fixture(t, true);
  assert.deepEqual(await f.store.read({ autoCheck: false, autoDownload: false }), { autoCheck: false, autoDownload: false });
  await rm(path.join(f.root, "Local Storage"), { recursive: true });
  const restarted = createUpdaterPreferences(f.app);
  assert.deepEqual(await restarted.read(), { autoCheck: false, autoDownload: false });
  assert.deepEqual(await restarted.read({ autoCheck: true }), { autoCheck: false, autoDownload: false });
});
test("existing profiles with lost browser preferences do not restart automatic updates", async t => {
  const f = await fixture(t, true);
  assert.deepEqual(await f.store.read(), { autoCheck: false, autoDownload: false });
});
test("migrates a user's enabled settings without resetting them", async t => {
  const f = await fixture(t, true);
  assert.deepEqual(await f.store.read({ autoCheck: true, autoDownload: true }), { autoCheck: true, autoDownload: true });
});
test("malformed, invalid and unreadable native files disable automation, even with stale browser consent", async t => {
  const f = await fixture(t, true);
  for (const invalid of ["{", "null", '{"autoCheck":"yes","autoDownload":false}']) {
    await writeFile(f.filename, invalid);
    assert.deepEqual(await createUpdaterPreferences(f.app).read({ autoCheck: true }), { autoCheck: false, autoDownload: false });
    assert.equal(await readFile(f.filename, "utf8"), invalid);
  }
  await rm(f.filename);
  await mkdir(f.filename);
  assert.deepEqual(await createUpdaterPreferences(f.app).read({ autoCheck: true }), { autoCheck: false, autoDownload: false });
});
test("an explicit saved change repairs corruption and persists across restarts", async t => {
  const f = await fixture(t, true);
  await writeFile(f.filename, "{");
  assert.deepEqual(await f.store.write({ autoCheck: true }), { autoCheck: true, autoDownload: false });
  assert.deepEqual(await createUpdaterPreferences(f.app).read(), { autoCheck: true, autoDownload: false });
});
test("deleted settings during a running process cannot be reconstructed from stale browser values", async t => {
  const f = await fixture(t);
  await f.store.read();
  await rm(f.filename);
  assert.deepEqual(await f.store.read({ autoCheck: true }), { autoCheck: false, autoDownload: false });
});
test("serialized patches preserve both switches and reject non-boolean values", async t => {
  const f = await fixture(t, true);
  await Promise.all([f.store.write({ autoCheck: true }), f.store.write({ autoDownload: true })]);
  assert.deepEqual(await f.store.read(), { autoCheck: true, autoDownload: true });
  await assert.rejects(f.store.write({ autoCheck: "true" }), /Invalid update preferences/);
});
