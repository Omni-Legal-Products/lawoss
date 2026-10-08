import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createWorkspaceStore } from "./workspace-store.mjs";
import { ensureLawossHomeWorkspace, lawossHomeWorkspacePath, LAWOSS_HOME_DIR_NAME } from "./lawoss-home-workspace.mjs";

// Bez obnovy z perzistovaného stavu hostiteľa by test videl cudzie priečinky z ~/.config.
process.env.LEGALWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY = "1";

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "lawoss-home-")));
  const userData = path.join(root, "userData");
  await mkdir(userData);
  const workspaceStore = createWorkspaceStore({ app: { getPath: () => userData }, defaultDenBaseUrl: "https://example.test", defaultRequireSignin: false, forceRequireSignin: false });
  return { root, userData, workspaceStore };
}

test("bez priečinka zaregistruje prázdny domovský priestor mimo klientov, bez zápisu doň", async () => {
  const { userData, workspaceStore } = await fixture();
  assert.equal(await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir }), true);
  const state = await workspaceStore.readWorkspaceState();
  assert.equal(state.workspaces.length, 1);
  assert.equal(state.workspaces[0].path, lawossHomeWorkspacePath(userData));
  assert.equal(path.basename(state.workspaces[0].path), LAWOSS_HOME_DIR_NAME);
  assert.equal(state.workspaces[0].appFiles, "outside");
  assert.deepEqual(await readdir(lawossHomeWorkspacePath(userData)), []);
});

test("s existujúcim lokálnym priečinkom nerobí nič", async () => {
  const { root, userData, workspaceStore } = await fixture();
  const client = path.join(root, "Klient");
  await mkdir(client);
  await workspaceStore.createWorkspace({ folderPath: client, registerExisting: true });
  assert.equal(await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir }), false);
  assert.equal((await workspaceStore.readWorkspaceState()).workspaces.length, 1);
});

test("opakované volanie je idempotentné", async () => {
  const { userData, workspaceStore } = await fixture();
  await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir });
  assert.equal(await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir }), false);
  assert.equal((await workspaceStore.readWorkspaceState()).workspaces.length, 1);
});

test("po pridaní klienta ostane domovský priestor v zozname, ale nový nevznikne a klient je vybraný", async () => {
  const { root, userData, workspaceStore } = await fixture();
  await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir });
  const client = path.join(root, "Klient");
  await mkdir(client);
  await workspaceStore.createWorkspace({ folderPath: client, registerExisting: true });
  assert.equal(await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir }), false);
  const state = await workspaceStore.readWorkspaceState();
  assert.equal(state.workspaces.length, 2);
  assert.equal(state.workspaces.find((entry) => entry.id === state.selectedId)?.path, client);
});

test("zmazaný priečinok domova na disku sa pri ďalšom volaní obnoví bez duplicity", async () => {
  const { userData, workspaceStore } = await fixture();
  await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir });
  await rm(lawossHomeWorkspacePath(userData), { recursive: true, force: true });
  assert.equal(await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir }), false);
  assert.deepEqual(await readdir(lawossHomeWorkspacePath(userData)), []);
  assert.equal((await workspaceStore.readWorkspaceState()).workspaces.length, 1);
});

test("ak výber ukazuje na domov a existuje skutočný priečinok, výber prejde na skutočný", async () => {
  const { root, userData, workspaceStore } = await fixture();
  await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir });
  const client = path.join(root, "Klient");
  await mkdir(client);
  await workspaceStore.createWorkspace({ folderPath: client, registerExisting: true });
  const homeEntry = (await workspaceStore.readWorkspaceState()).workspaces.find((entry) => entry.path === lawossHomeWorkspacePath(userData));
  await workspaceStore.setSelectedWorkspace(homeEntry.id);
  await workspaceStore.setRuntimeActiveWorkspace(homeEntry.id);
  await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir });
  const state = await workspaceStore.readWorkspaceState();
  const clientEntry = state.workspaces.find((entry) => entry.path === client);
  assert.equal(state.selectedId, clientEntry.id);
  assert.equal(state.activeId, clientEntry.id);
  assert.equal(state.watchedId, clientEntry.id);
});

test("ak je domov jediný, výber ostane na ňom", async () => {
  const { userData, workspaceStore } = await fixture();
  await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir });
  await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir });
  const state = await workspaceStore.readWorkspaceState();
  assert.equal(state.selectedId, state.workspaces[0].id);
});
