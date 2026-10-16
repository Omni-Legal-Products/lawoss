import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadISIRCorpus, sha256 } from "./corpus.mjs";

const roots = [];
afterEach(async () => { while (roots.length) await rm(roots.pop(), { recursive: true, force: true }); });
async function fixture(documentPath = "source.pdf") {
  const root = await mkdtemp(join(tmpdir(), "lawoss-corpus-check-")); roots.push(root);
  const directory = join(root, "corpus"); await mkdir(directory);
  const bytes = Buffer.from("%PDF-1.7\nfixture\n%%EOF\n");
  await writeFile(join(directory, "source.pdf"), bytes);
  await writeFile(join(root, "outside.pdf"), bytes);
  const document = { name: "source.pdf", path: documentPath, bytes: bytes.length, sha256: sha256(bytes) };
  const manifest = { version: 1, source: "ISIR", cases: Array.from({ length: 10 }, (_, i) => ({
    id: `case-${String(i + 1).padStart(2, "0")}`, documents: [document, { ...document, name: "second.pdf" }],
  })) };
  const path = join(directory, "corpus.json"); await writeFile(path, JSON.stringify(manifest));
  return { root, directory, bytes, path };
}
test("a corrupted snapshot is rejected before attachment testing", async () => {
  const f = await fixture();
  await writeFile(join(f.directory, "source.pdf"), "%PDF-1.7\nchanged\n%%EOF\n");
  await assert.rejects(loadISIRCorpus(f.path), /integrity/);
});
test("a manifest cannot read a document outside its snapshot root", async () => {
  const f = await fixture("../outside.pdf");
  await assert.rejects(loadISIRCorpus(f.path), /escapes/);
  assert.deepEqual(await readFile(join(f.root, "outside.pdf")), f.bytes);
});
test("downloader refuses Git output and preserves an existing snapshot", async () => {
  const f = await fixture(), script = fileURLToPath(new URL("./prepare-corpus.py", import.meta.url));
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const output = join(repo, "lawoss/testing/isir/should-not-be-created");
  const python = process.platform === "win32" ? "python" : "python3";
  const forbidden = spawnSync(python, [script, "--output", output], { encoding: "utf8" });
  assert.equal(forbidden.error, undefined);
  assert.notEqual(forbidden.status, 0); assert.match(forbidden.stderr, /outside Git/);
  assert.equal(await stat(output).catch(() => null), null);
  const original = await readFile(f.path);
  const existing = spawnSync(python, [script, "--output", f.directory], { encoding: "utf8" });
  assert.notEqual(existing.status, 0); assert.match(existing.stderr, /preserved/);
  assert.deepEqual(await readFile(f.path), original);
});
