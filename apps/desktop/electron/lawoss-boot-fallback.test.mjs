import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { pickBootFallbackWorkspace } from "./lawoss-boot-fallback.mjs";

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "lawoss-boot-fallback-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("náhradný klient preskočí chýbajúci priečinok a priečinok nevytvorí", async (t) => {
  const root = await fixture(t);
  const selected = path.join(root, "Klient A");
  const missing = path.join(root, "Klient B");
  const present = path.join(root, "Klient C");
  await mkdir(selected);
  await mkdir(present);
  const workspaces = [
    { id: "a", path: selected, workspaceType: "local" },
    { id: "b", path: missing, workspaceType: "local" },
    { id: "c", path: present, workspaceType: "local" },
  ];
  assert.equal(pickBootFallbackWorkspace(workspaces, selected)?.id, "c");
  assert.deepEqual((await readdir(root)).sort(), ["Klient A", "Klient C"]);
});

test("bez existujúceho náhradného priečinka nevráti nič (štart nahlási pôvodnú chybu)", async (t) => {
  const root = await fixture(t);
  const selected = path.join(root, "Klient A");
  const file = path.join(root, "subor.txt");
  await mkdir(selected);
  await writeFile(file, "nie priečinok\n");
  const workspaces = [
    { id: "a", path: selected, workspaceType: "local" },
    { id: "b", path: path.join(root, "Klient B"), workspaceType: "local" },
    { id: "f", path: file, workspaceType: "local" },
    { id: "r", path: root, workspaceType: "remote" },
    { id: "e", path: "  " },
  ];
  assert.equal(pickBootFallbackWorkspace(workspaces, selected), undefined);
});
