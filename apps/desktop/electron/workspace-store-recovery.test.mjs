import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createWorkspaceStore } from "./workspace-store.mjs";

function store(root) {
  return createWorkspaceStore({ app: { getPath: () => root }, defaultDenBaseUrl: "https://example.test", defaultRequireSignin: false, forceRequireSignin: false });
}

test("an interrupted atomic write keeps committed state and only reaps old dead-owner temporary files", async t => {
  if (process.platform === "win32") return t.skip("SIGKILL fixture uses POSIX process semantics");
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-workspace-interruption-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const committed = JSON.stringify({ workspaces: [], selectedId: "", activeId: null, watchedId: null, recoveryCompleted: true });
  const filename = path.join(root, "legalwork-workspaces.json");
  await writeFile(filename, committed);
  // Stop the real writer exactly when its temporary file exists, before rename.
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { readdirSync } from 'node:fs';
    import { createWorkspaceStore } from ${JSON.stringify(new URL("./workspace-store.mjs", import.meta.url).href)};
    const root = process.argv[1];
    const timer = setInterval(() => { if (readdirSync(root).some(name => name.endsWith('.tmp'))) process.kill(process.pid, 'SIGKILL'); }, 1);
    timer.unref();
    await createWorkspaceStore({ app: { getPath: () => root }, defaultDenBaseUrl: '', defaultRequireSignin: false, forceRequireSignin: false }).writeWorkspaceState({ workspaces: [], selectedId: 'x'.repeat(64 * 1024 * 1024) });
  `, root], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const outcome = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (code, signal) => resolve({ code, signal })); });
  assert.equal(outcome.signal, "SIGKILL", stderr);
  assert.equal(await readFile(filename, "utf8"), committed);
  const [orphan] = (await readdir(root)).filter(name => name.endsWith(".tmp"));
  assert.match(orphan, /^legalwork-workspaces\.json\.\d+\.[a-f0-9]{12}\.tmp$/);
  const old = new Date(Date.now() - 120_000);
  await utimes(path.join(root, orphan), old, old);
  const live = `legalwork-workspaces.json.${process.pid}.123456789abc.tmp`;
  const young = `legalwork-workspaces.json.${child.pid}.123456789abc.tmp`;
  const unrelated = "other-store.json.999999.123456789abc.tmp";
  const link = `legalwork-workspaces.json.${child.pid}.abcdefabcdef.tmp`;
  for (const name of [live, young, unrelated]) await writeFile(path.join(root, name), "keep");
  await utimes(path.join(root, live), old, old);
  await utimes(path.join(root, unrelated), old, old);
  await symlink(filename, path.join(root, link));
  await store(root).readWorkspaceState();
  const remaining = await readdir(root);
  assert.ok(!remaining.includes(orphan));
  for (const name of [live, young, unrelated, link]) assert.ok(remaining.includes(name), `${name} must be preserved`);
  assert.equal(await readFile(filename, "utf8"), committed);
});

test("an ordinary rename failure cleans up its own temporary file", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-workspace-failed-write-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "legalwork-workspaces.json"));
  await assert.rejects(store(root).writeWorkspaceState({ workspaces: [] }));
  assert.deepEqual(await readdir(root), ["legalwork-workspaces.json"]);
});
