import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, readlink, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createWorkspaceStore } from "./workspace-store.mjs";

function workspaceIdForPath(workspacePath) {
  return `ws_${createHash("sha256").update(workspacePath).digest("hex").slice(0, 12)}`;
}

function createTestStore(root, userData) {
  return createWorkspaceStore({
    app: { getPath: (name) => name === "userData" ? userData : root },
    defaultDenBaseUrl: "https://example.test",
    defaultRequireSignin: false,
    forceRequireSignin: false,
  });
}

async function snapshotTree(root) {
  const snapshot = [];
  async function visit(directory, relativeDirectory = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        snapshot.push([relativePath, "directory"]);
        await visit(absolutePath, relativePath);
      } else if (entry.isSymbolicLink()) {
        snapshot.push([relativePath, "symlink", await readlink(absolutePath)]);
      } else {
        snapshot.push([relativePath, "file", (await readFile(absolutePath)).toString("hex")]);
      }
    }
  }
  await visit(root);
  return snapshot;
}

test("recovers empty desktop workspace state from token store paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-workspace-store-"));
  const userData = path.join(root, "userData");
  const oldWorkspace = path.join(root, "old-workspace");
  await mkdir(oldWorkspace, { recursive: true });
  const oldWorkspaceReal = await realpath(oldWorkspace);
  await mkdir(userData, { recursive: true });

  await writeFile(
    path.join(userData, "legalwork-workspaces.json"),
    JSON.stringify({ selectedId: "ws_missing", activeId: "ws_missing", watchedId: null, workspaces: [] }),
    "utf8",
  );
  await writeFile(
    path.join(userData, "legalwork-server-tokens.json"),
    JSON.stringify({
      version: 1,
      workspaces: {
        "": { updatedAt: 3 },
        [oldWorkspace]: { updatedAt: 2 },
        [path.join(root, "missing")]: { updatedAt: 4 },
      },
    }),
    "utf8",
  );

  const previous = process.env.LEGALWORK_SERVER_CONFIG;
  process.env.LEGALWORK_SERVER_CONFIG = path.join(root, "missing-server.json");
  try {
    const store = createWorkspaceStore({
      app: { getPath: (name) => name === "userData" ? userData : root },
      defaultDenBaseUrl: "https://example.test",
      defaultRequireSignin: false,
      forceRequireSignin: false,
    });

    const state = await store.readWorkspaceState();
    assert.equal(state.workspaces.length, 1);
    assert.equal(state.workspaces[0].path, oldWorkspaceReal);
    assert.equal(state.selectedId, state.workspaces[0].id);
    assert.equal(state.watchedId, state.workspaces[0].id);

    const persisted = JSON.parse(await readFile(path.join(userData, "legalwork-workspaces.json"), "utf8"));
    assert.equal(persisted.workspaces.length, 1);
    assert.equal(persisted.selectedWorkspaceId, state.workspaces[0].id);
  } finally {
    if (previous === undefined) delete process.env.LEGALWORK_SERVER_CONFIG;
    else process.env.LEGALWORK_SERVER_CONFIG = previous;
  }
});

test("prefers server config workspaces when desktop state is empty", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-workspace-store-"));
  const userData = path.join(root, "userData");
  const oldWorkspace = path.join(root, "server-workspace");
  const serverConfig = path.join(root, "server.json");
  await mkdir(oldWorkspace, { recursive: true });
  await mkdir(userData, { recursive: true });
  const oldWorkspaceReal = await realpath(oldWorkspace);

  await writeFile(
    path.join(userData, "legalwork-workspaces.json"),
    JSON.stringify({ selectedId: "", activeId: null, watchedId: null, workspaces: [] }),
    "utf8",
  );
  await writeFile(
    serverConfig,
    JSON.stringify({ workspaces: [{ path: oldWorkspace, name: "From Server" }] }),
    "utf8",
  );
  await writeFile(
    path.join(userData, "legalwork-server-tokens.json"),
    JSON.stringify({ version: 1, workspaces: { [path.join(root, "other")]: { updatedAt: 9 } } }),
    "utf8",
  );

  const previous = process.env.LEGALWORK_SERVER_CONFIG;
  process.env.LEGALWORK_SERVER_CONFIG = serverConfig;
  try {
    const store = createWorkspaceStore({
      app: { getPath: (name) => name === "userData" ? userData : root },
      defaultDenBaseUrl: "https://example.test",
      defaultRequireSignin: false,
      forceRequireSignin: false,
    });

    const state = await store.readWorkspaceState();
    assert.equal(state.workspaces.length, 1);
    assert.equal(state.workspaces[0].path, oldWorkspaceReal);
    assert.equal(state.workspaces[0].name, "From Server");
  } finally {
    if (previous === undefined) delete process.env.LEGALWORK_SERVER_CONFIG;
    else process.env.LEGALWORK_SERVER_CONFIG = previous;
  }
});

test("normalizes recovered remote LegalWork entries before persisting", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-workspace-store-"));
  const userData = path.join(root, "userData");
  const serverConfig = path.join(root, "server.json");
  await mkdir(userData, { recursive: true });

  await writeFile(
    path.join(userData, "legalwork-workspaces.json"),
    JSON.stringify({ selectedId: "", activeId: null, watchedId: null, workspaces: [] }),
    "utf8",
  );
  await writeFile(
    serverConfig,
    JSON.stringify({
      workspaces: [
        {
          id: "legacy_one",
          path: "/workspace",
          workspaceType: "remote",
          remoteType: "legalwork",
          baseUrl: "https://worker.example.com/workspace/ws_remote",
        },
        {
          id: "legacy_two",
          path: "/workspace",
          workspaceType: "remote",
          remoteType: "legalwork",
          baseUrl: "https://worker.example.com/w/ws_remote",
        },
      ],
    }),
    "utf8",
  );

  const previous = process.env.LEGALWORK_SERVER_CONFIG;
  process.env.LEGALWORK_SERVER_CONFIG = serverConfig;
  try {
    const store = createWorkspaceStore({
      app: { getPath: (name) => name === "userData" ? userData : root },
      defaultDenBaseUrl: "https://example.test",
      defaultRequireSignin: false,
      forceRequireSignin: false,
    });

    const state = await store.readWorkspaceState();
    assert.equal(state.workspaces.length, 1);
    assert.equal(state.workspaces[0].id, "rem_ws_remote");
    assert.equal(state.workspaces[0].baseUrl, "https://worker.example.com");
    assert.equal(state.workspaces[0].legalworkWorkspaceId, "ws_remote");
    assert.equal(state.selectedId, "rem_ws_remote");
  } finally {
    if (previous === undefined) delete process.env.LEGALWORK_SERVER_CONFIG;
    else process.env.LEGALWORK_SERVER_CONFIG = previous;
  }
});

test("registers an existing canonical workspace without changing its files and persists it across restart", async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "legalwork-workspace-store-existing-")));
  const userData = path.join(root, "userData");
  const officePath = path.join(root, "office");
  const matterPath = path.join(root, "matter");
  const matterProfilePath = path.join(matterPath, ".lawoss", "memory-profile.json");
  await mkdir(userData, { recursive: true });
  await mkdir(officePath, { recursive: true });
  await mkdir(path.dirname(matterProfilePath), { recursive: true });
  await mkdir(path.join(matterPath, "documents", "nested"), { recursive: true });
  await writeFile(path.join(matterPath, "sentinel.txt"), "SYNTHETIC MATTER SENTINEL\n", "utf8");
  await writeFile(path.join(matterPath, "documents", "nested", "bytes.bin"), Buffer.from([0, 1, 2, 254, 255]));
  await writeFile(matterProfilePath, '{"version":1,"matterId":"SYNTHETIC"}\n', "utf8");
  const officeRealPath = await realpath(officePath);
  const matterRealPath = await realpath(matterPath);
  const officeId = workspaceIdForPath(officeRealPath);
  const matterId = workspaceIdForPath(matterRealPath);
  const statePath = path.join(userData, "legalwork-workspaces.json");
  const officeState = {
    selectedId: officeId,
    activeId: officeId,
    watchedId: officeId,
    workspaces: [{ id: officeId, name: "Office", path: officeRealPath, preset: "starter", workspaceType: "local" }],
  };
  await writeFile(statePath, `${JSON.stringify(officeState, null, 2)}\n`, "utf8");

  const store = createTestStore(root, userData);
  const selectedOnly = await store.setSelectedWorkspace(matterId);
  assert.equal(selectedOnly.selectedId, matterId);
  assert.deepEqual(selectedOnly.workspaces.map((workspace) => workspace.id), [officeId]);
  await writeFile(statePath, `${JSON.stringify(officeState, null, 2)}\n`, "utf8");

  const matterBefore = await snapshotTree(matterRealPath);
  const registered = await store.createWorkspace({
    folderPath: matterRealPath,
    name: "Same title",
    preset: "starter",
    registerExisting: true,
  });
  assert.deepEqual(registered.workspaces.map((workspace) => workspace.id), [officeId, matterId]);
  assert.deepEqual(registered.workspaces.find((workspace) => workspace.id === matterId), {
    id: matterId,
    name: "Same title",
    path: matterRealPath,
    preset: "starter",
    workspaceType: "local",
    remoteType: null,
    baseUrl: null,
    directory: null,
    displayName: "Same title",
    legalworkHostUrl: null,
    legalworkToken: null,
    legalworkClientToken: null,
    legalworkHostToken: null,
    legalworkWorkspaceId: null,
    legalworkWorkspaceName: null,
    sandboxBackend: null,
    sandboxRunId: null,
    sandboxContainerName: null,
  });
  assert.equal(registered.selectedId, matterId);
  assert.equal(registered.activeId, matterId);
  assert.equal(registered.watchedId, matterId);
  assert.deepEqual(await snapshotTree(matterRealPath), matterBefore);
  assert.equal(matterBefore.some(([entry]) => entry === ".opencode"), false);

  const persisted = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(persisted.workspaces.filter((workspace) => workspace.id === matterId).length, 1);
  assert.equal(persisted.selectedId, matterId);
  assert.equal(persisted.selectedWorkspaceId, matterId);
  assert.equal(persisted.activeId, matterId);
  assert.equal(persisted.watchedId, matterId);
  assert.equal(persisted.watchedWorkspaceId, matterId);

  const restarted = createTestStore(root, userData);
  const afterRestart = await restarted.readWorkspaceState();
  assert.deepEqual(afterRestart.workspaces.map((workspace) => workspace.id), [officeId, matterId]);
  assert.equal(afterRestart.selectedId, matterId);
  assert.equal(afterRestart.activeId, matterId);
  assert.equal(afterRestart.watchedId, matterId);

  const retry = await restarted.createWorkspace({ folderPath: matterRealPath, name: "Same title", preset: "starter", registerExisting: true });
  assert.equal(retry.workspaces.filter((workspace) => workspace.id === matterId).length, 1);
  assert.deepEqual(await snapshotTree(matterRealPath), matterBefore);

  const stateBeforeInvalidInputs = await readFile(statePath, "utf8");
  const filePath = path.join(root, "not-a-directory.txt");
  await writeFile(filePath, "file\n", "utf8");
  const invalidInputs = [
    { folderPath: path.join(root, "missing"), registerExisting: true },
    { folderPath: filePath, registerExisting: true },
    { folderPath: path.relative(process.cwd(), matterRealPath), registerExisting: true },
    { folderPath: matterRealPath, registerExisting: "true" },
  ];
  for (const input of invalidInputs) {
    await assert.rejects(() => restarted.createWorkspace(input));
    assert.equal(await readFile(statePath, "utf8"), stateBeforeInvalidInputs);
    assert.deepEqual(await snapshotTree(matterRealPath), matterBefore);
  }

  await t.test("native registration rejects directory aliases when supported", async (t) => {
    const aliasPath = path.join(root, "matter-alias");
    try {
      await symlink(matterRealPath, aliasPath, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && ["EACCES", "EPERM", "ENOTSUP"].includes(String(error.code))) {
        t.skip(`directory alias capability unavailable (${String(error.code)})`);
        return;
      }
      throw error;
    }
    await assert.rejects(() => restarted.createWorkspace({ folderPath: aliasPath, registerExisting: true }));
    assert.equal(await readFile(statePath, "utf8"), stateBeforeInvalidInputs);
    assert.deepEqual(await snapshotTree(matterRealPath), matterBefore);
  });

  const defaultCreatePath = path.join(root, "default-create");
  await restarted.createWorkspace({ folderPath: defaultCreatePath, name: "Default" });
  assert.equal((await snapshotTree(defaultCreatePath)).some(([entry]) => entry === ".opencode"), true);
  const falseCreatePath = path.join(root, "false-create");
  await restarted.createWorkspace({ folderPath: falseCreatePath, name: "False", registerExisting: false });
  assert.equal((await snapshotTree(falseCreatePath)).some(([entry]) => entry === ".opencode"), true);
});
