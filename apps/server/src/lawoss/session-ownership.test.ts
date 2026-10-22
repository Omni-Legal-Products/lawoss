import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceInfo } from "../types.js";
import { joinSessionFolder, sessionFolder, sessionFolderRoot } from "./session-ownership.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await removeTestDir(root); });

test("priečinok chatu pod koreňom klienta: prípad, koreň, súrodenec, odkaz, vzdialený worker", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-session-folder-")));
  roots.push(base);
  const client = join(base, "Klient_A"), matter = join(client, "Spisy", "M001-Úhrada"), sibling = join(base, "Klient-A");
  for (const folder of [matter, sibling]) await mkdir(folder, { recursive: true });
  const alias = join(base, "odkaz");
  await symlink(client, alias, "junction");
  const local = (path: string): WorkspaceInfo => ({ id: "a", name: "A", path, preset: "starter", workspaceType: "local" });

  expect(await sessionFolder(local(client), { directory: matter })).toEqual(["Spisy", "M001-Úhrada"]);
  expect(await sessionFolder(local(client), { directory: client })).toEqual([]);
  // Zapísaný v NFD (macOS): zhoda podľa NFC, segmenty v pravopise enginu.
  expect(await sessionFolder(local(client), { directory: matter.normalize("NFD") })).toEqual(["Spisy", "M001-Úhrada".normalize("NFD")]);
  // Priečinok klienta cez odkaz: engine hlási realpath.
  expect(await sessionFolder(local(alias), { directory: matter })).toEqual(["Spisy", "M001-Úhrada"]);
  // Mimo koreňa (súrodenec s podobným menom) a bez priečinka: koreň, nikdy cesta von.
  expect(await sessionFolder(local(client), { directory: sibling })).toEqual([]);
  expect(await sessionFolder(local(client), { directory: join(client, "..", "Klient-A") })).toEqual([]);
  expect(await sessionFolder(local(client), { directory: null })).toEqual([]);
  expect(await sessionFolder({ ...local(client), workspaceType: "remote" }, { directory: matter })).toEqual([]);
});

test("jeden základ pre priečinok chatu: počíta sa aj pripája k `directory || path`; koreňový chat ponechá doterajší zápis", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-session-folder-root-")));
  roots.push(base);
  const configured = join(base, "nakonfigurovany"), legacy = join(base, "povodny"), matter = join(configured, "Spisy", "M002");
  for (const folder of [matter, legacy]) await mkdir(folder, { recursive: true });
  const workspace: WorkspaceInfo = { id: "a", name: "A", path: legacy, directory: configured, preset: "starter", workspaceType: "local" };
  const folder = await sessionFolder(workspace, { directory: matter });
  expect(folder).toEqual(["Spisy", "M002"]);
  expect(sessionFolderRoot(workspace)).toBe(configured);
  expect(joinSessionFolder(workspace, folder, legacy)).toBe(matter);
  expect(joinSessionFolder(workspace, [], legacy)).toBe(legacy);
});
