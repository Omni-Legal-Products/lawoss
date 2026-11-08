import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createChevron7Signing, findChevron7Signing, isSigningPdf, runChevron7QuickAction } from "./lawoss-chevron7-signing.mjs";

test("unsupported platform never probes or launches installed apps", async () => {
  assert.equal(await findChevron7Signing({ platform: "linux", roots: [] }), null);
});

test("signing requires one valid chosen PDF and native confirmation; duplicate requests are bounded", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lawoss-chevron7-syn-"));
  const file = path.join(dir, "SYN example.pdf");
  await writeFile(file, "%PDF-1.4\n%%EOF");
  const calls = [];
  let release = (_file) => {};
  const bridge = createChevron7Signing({ platform: "darwin", roots: [] }, {
    find: async () => ({ available: true, bundle: "/test/Chevron7.app", script: "/test/quick-action.sh", version: "1.18.0" }),
    verify: async bundle => calls.push(["verify", bundle]),
    run: async (script, input) => { calls.push(["run", script, input]); return { status: "returned" }; },
  });
  try {
    assert.equal((await bridge.status()).signingAvailable, true);
    assert.equal(calls.length, 0);
    assert.deepEqual(await bridge.sign({ chooseFile: async () => null, confirmFile: async () => true }), { status: "cancelled" });
    assert.deepEqual(await bridge.sign({ chooseFile: async () => file, confirmFile: async () => false }), { status: "cancelled" });
    assert.equal(calls.length, 0);
    const first = bridge.sign({ chooseFile: () => new Promise(resolve => { release = resolve; }), confirmFile: async name => name === "SYN example.pdf" });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await bridge.sign({ chooseFile: async () => null, confirmFile: async () => false }), { status: "busy" });
    release(file);
    assert.deepEqual(await first, { status: "returned" });
    assert.deepEqual(calls, [["verify", "/test/Chevron7.app"], ["run", "/test/quick-action.sh", await realpath(file)]]);
    bridge.dispose();
    assert.deepEqual(await bridge.sign({ chooseFile: async () => null, confirmFile: async () => false }), { status: "unavailable" });
  } finally { bridge.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("rejects directories and disguised PDFs; signature verification failure does not launch helper", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lawoss-chevron7-syn-"));
  const file = path.join(dir, "SYN.pdf");
  let ran = false;
  const bridge = createChevron7Signing({}, {
    find: async () => ({ available: true, bundle: "bundle", script: "script" }),
    verify: async () => { throw Error("invalid signature"); },
    run: async () => { ran = true; },
  });
  try {
    await writeFile(file, "not a pdf");
    assert.equal(await isSigningPdf(dir), false);
    assert.deepEqual(await bridge.sign({ chooseFile: async () => file, confirmFile: async () => true }), { status: "invalid-file" });
    await writeFile(file, "%PDF-1.4");
    assert.deepEqual(await bridge.sign({ chooseFile: async () => file, confirmFile: async () => true }), { status: "failed" });
    assert.equal(ran, false);
  } finally { bridge.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("helper receives literal argv, no inherited provider secret, and timeout stops descendants", async () => {
  if (process.platform === "win32") return;
  const dir = await mkdtemp(path.join(tmpdir(), "lawoss-chevron7-syn-"));
  const script = path.join(dir, "fake.sh");
  process.env.LAWOSS_SYN_SECRET = "do-not-inherit";
  try {
    await writeFile(script, '[[ "$1" == \'/tmp/SYN $(false).pdf\' ]] || exit 2\n[[ -z "$LAWOSS_SYN_SECRET" ]] || exit 3\nexit 0\n');
    assert.deepEqual(await runChevron7QuickAction(script, "/tmp/SYN $(false).pdf"), { status: "returned" });
    await writeFile(script, "sleep 60\n");
    assert.deepEqual(await runChevron7QuickAction(script, "/tmp/SYN.pdf", { timeout: 30 }), { status: "interrupted" });
  } finally { delete process.env.LAWOSS_SYN_SECRET; await rm(dir, { recursive: true, force: true }); }
});
