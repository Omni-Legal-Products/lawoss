import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadISIRCorpus, sha256 } from "../../../lawoss/testing/isir/corpus.mjs";
import { copyFilesIntoProject } from "./project-file-copy.mjs";

const roots = [];
afterEach(async () => { while (roots.length) await rm(roots.pop(), { recursive: true, force: true }); });

test("native picker/drop copies ISIR originals into the selected case, preserving duplicate names", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-isir-native-")));
  roots.push(root);
  const corpus = await loadISIRCorpus(), project = join(root, "Practice");
  await mkdir(project);
  for (const entry of corpus.cases) {
    const folder = join("Spisy", entry.id, "Přílohy"), source = join(root, "Source", entry.id);
    await mkdir(join(project, folder), { recursive: true });
    await mkdir(source, { recursive: true });
    const paths = [];
    for (const document of entry.documents) {
      const path = join(source, document.name);
      await writeFile(path, document.bytes);
      paths.push(path);
    }
    const copied = await copyFilesIntoProject(project, paths, undefined, folder);
    const repeated = await copyFilesIntoProject(project, paths, undefined, folder);
    assert.equal(copied.files.length, entry.documents.length);
    assert.ok([...copied.files, ...repeated.files].every(file => file.status === "copied"));
    for (const [index, document] of entry.documents.entries()) {
      const expected = sha256(document.bytes);
      assert.notEqual(copied.files[index].path, repeated.files[index].path);
      assert.equal(sha256(await readFile(join(project, copied.files[index].path))), expected);
      assert.equal(sha256(await readFile(join(project, repeated.files[index].path))), expected);
      assert.equal(sha256(await readFile(paths[index])), expected);
      if (document.sourcePath) assert.equal(sha256(await readFile(document.sourcePath)), expected);
    }
  }
});

test("native attachment to a missing case fails and leaves source documents intact", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-isir-missing-")));
  roots.push(root);
  const corpus = await loadISIRCorpus(), document = corpus.cases[0].documents[0];
  const source = join(root, document.name);
  await writeFile(source, document.bytes);
  const missing = join(root, "unavailable-case");
  await assert.rejects(copyFilesIntoProject(missing, [source]), /ENOENT|unavailable/);
  assert.equal(await stat(missing).catch(() => null), null);
  assert.equal(sha256(await readFile(source)), sha256(document.bytes));
});
