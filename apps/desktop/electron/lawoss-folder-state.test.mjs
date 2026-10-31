import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { lawossFolderState } from "./lawoss-folder-state.mjs";

test("stav priečinka pre kartu: existuje, súbor, neexistuje; relatívna cesta nič", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lawoss-folder-state-"));
  try {
    await mkdir(path.join(root, "Klienti", "C001"), { recursive: true });
    await writeFile(path.join(root, "Klienti", "zmluva.txt"), "x");
    assert.equal(await lawossFolderState(path.join(root, "Klienti", "C001")), "dir");
    assert.equal(await lawossFolderState(path.join(root, "Klienti", "zmluva.txt")), "other");
    assert.equal(await lawossFolderState(path.join(root, "Klienti", "C002")), "missing");
    assert.equal(await lawossFolderState(path.join(root, "Klienti", "zmluva.txt", "x")), "missing");
    for (const value of ["Klienti/C002", "", 42, null, `${root}\0x`]) assert.equal(await lawossFolderState(value), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
