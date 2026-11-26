import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, realpath, symlink, mkdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createChevron7Signing, currentSigningWorkspace, signingWorkspaceRoot, findChevron7Signing, isSigningPdf, runChevron7QuickAction } from "./lawoss-chevron7-signing.mjs";

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
    const input = { relativePath: "SYN example.pdf", resolveWorkspace: async () => dir };
    assert.deepEqual(await bridge.sign({ ...input, confirmFile: async () => false }), { status: "cancelled" });
    assert.equal(calls.length, 0);
    let confirmed;
    let waiting;
    const ready = new Promise(resolve => { waiting = resolve; });
    const first = bridge.sign({ ...input, confirmFile: name => {
      confirmed = name;
      waiting();
      return new Promise(resolve => { release = resolve; });
    } });
    await ready;
    assert.equal(confirmed, await realpath(file));
    assert.deepEqual(await bridge.sign({ ...input, confirmFile: async () => true }), { status: "busy" });
    release(true);
    assert.deepEqual(await first, { status: "returned" });
    assert.deepEqual(calls, [["verify", "/test/Chevron7.app"], ["run", "/test/quick-action.sh", await realpath(file)]]);
    bridge.dispose();
    assert.deepEqual(await bridge.sign({ ...input, confirmFile: async () => true }), { status: "unavailable" });
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
    assert.deepEqual(await bridge.sign({ relativePath: "SYN.pdf", resolveWorkspace: async () => dir, confirmFile: async () => true }), { status: "invalid-file" });
    await writeFile(file, Buffer.from([0xa5, 0xd0, 0xc4, 0xc6, 0xad]));
    assert.equal(await isSigningPdf(file), false);
    await writeFile(file, "%PDF-1.4");
    assert.deepEqual(await bridge.sign({ relativePath: "SYN.pdf", resolveWorkspace: async () => dir, confirmFile: async () => true }), { status: "failed" });
    assert.equal(ran, false);
  } finally { bridge.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("binds file actions to the current window and local server", () => {
  const state = { selectedId: "second", workspaces: [{ id: "first" }, { id: "second" }, { id: "remote", workspaceType: "remote" }] };
  const server = { running: true, baseUrl: "http://127.0.0.1:1500" };
  const request = { workspaceId: "first", serverUrl: server.baseUrl };
  const route = "file:///app/index.html#/workspace/first/files";
  assert.equal(currentSigningWorkspace(request, route, state, server), "first");
  assert.equal(currentSigningWorkspace({ ...request, serverUrl: "http://127.0.0.1:1600" }, route, state, server), null);
  assert.equal(currentSigningWorkspace({ ...request, workspaceId: "second" }, route, state, server), null);
  assert.equal(currentSigningWorkspace(request, "file:///app/index.html#/session", state, server), null);
  assert.equal(currentSigningWorkspace({ ...request, workspaceId: "second" }, "file:///app/index.html#/session", state, server), "second");
  assert.equal(currentSigningWorkspace({ ...request, workspaceId: "remote" }, route.replace("first", "remote"), state, server), null);
  assert.equal(currentSigningWorkspace({ ...request, serverUrl: "https://example.org" }, route, state, { ...server, baseUrl: "https://example.org" }), null);
});

test("uses the live local project registry and refuses conflicting desktop folders", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "lawoss-chevron7-root-"));
  const documentRoot = path.join(folder, "served");
  await mkdir(documentRoot);
  const server = createServer((req, res) => {
    assert.equal(req.url, "/workspaces");
    assert.equal(req.headers.authorization, "Bearer fixture");
    res.end(JSON.stringify({ items: [{ id: "project", path: documentRoot, workspaceType: "local" }] }));
  });
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const info = { running: true, baseUrl: `http://127.0.0.1:${address.port}`, ownerToken: "fixture", clientToken: null };
    const request = { workspaceId: "project", serverUrl: info.baseUrl };
    const route = "file:///app#/workspace/project/files";
    assert.equal(await signingWorkspaceRoot(request, route, { workspaces: [] }, info), await realpath(documentRoot));
    assert.equal(await signingWorkspaceRoot(request, route, { workspaces: [{ id: "project", path: folder }] }, info), null);
    assert.equal(await signingWorkspaceRoot(request, null, { workspaces: [] }, info), null);
  } finally {
    await new Promise(resolve => server.close(() => resolve(undefined)));
    await rm(folder, { recursive: true, force: true });
  }
});

test("refuses out-of-workspace, changed or switched documents before handoff", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "lawoss-chevron7-boundary-"));
  const dir = path.join(parent, "workspace");
  const outside = path.join(parent, "outside.pdf");
  const file = path.join(dir, "inside.pdf");
  await mkdir(dir);
  await writeFile(file, "%PDF-1.4");
  await writeFile(outside, "%PDF-1.7");
  if (process.platform !== "win32") await symlink(outside, path.join(dir, "link.pdf"));
  const bridge = createChevron7Signing({}, {
    find: async () => ({ available: true, bundle: "bundle", script: "script" }),
    verify: async () => {},
    run: async () => { throw Error("unexpected handoff"); },
  });
  try {
    for (const relativePath of [file, "../outside.pdf", "link.pdf", "https://example.org/x.pdf", "nonexistent.pdf", "../workspace/inside.pdf"]) {
      assert.deepEqual(await bridge.sign({ relativePath, resolveWorkspace: async () => dir,
        confirmFile: async () => { throw Error("unexpected confirmation"); } }), { status: "invalid-file" });
    }
    let root = dir;
    assert.deepEqual(await bridge.sign({ relativePath: "inside.pdf", resolveWorkspace: async () => root,
      confirmFile: async () => { root = parent; return true; } }), { status: "invalid-file" });
    assert.deepEqual(await bridge.sign({ relativePath: "inside.pdf", resolveWorkspace: async () => dir,
      confirmFile: async () => { await rename(outside, file); return true; } }), { status: "invalid-file" });
  } finally { bridge.dispose(); await rm(parent, { recursive: true, force: true }); }
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
