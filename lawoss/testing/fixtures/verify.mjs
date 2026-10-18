import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// This pin binds the independent privacy review; a changed corpus needs a new review/version.
const expectedManifest = "e7cd7b73470269a1e02b0267b5a627db2dd02f05909f80f68a013a2cec7c965b";
const root = resolve(process.argv[2] ?? fileURLToPath(new URL("./cz-workflow-derived-v1", import.meta.url)));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = await readFile(resolve(root, "manifest.json"));
if (digest(bytes) !== expectedManifest) throw new Error("Frozen fixture manifest differs from the reviewed version");
const manifest = JSON.parse(bytes);
const actual = new Set();
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error("Frozen fixture contains a symlink");
    if (info.isDirectory()) await inspect(path);
    else if (info.isFile()) actual.add(relative(root, path).split(sep).join("/"));
    else throw new Error("Frozen fixture contains an unsupported filesystem entry");
  }
}
await inspect(root);
const names = Object.keys(manifest.files);
if (actual.size !== names.length + 1 || !actual.has("manifest.json")) throw new Error("Frozen fixture file allowlist differs");
for (const name of names) {
  if (!actual.has(name)) throw new Error("Frozen fixture is missing an expected file");
  const contents = await readFile(resolve(root, name));
  const expected = manifest.files[name];
  if (contents.length !== expected.bytes || digest(contents) !== expected.sha256) throw new Error(`Frozen fixture bytes differ: ${name}`);
}
console.log(JSON.stringify({ status: "PASS", files: actual.size, manifestSha256: expectedManifest, privacyReviewBoundToExactBytes: true }));
