import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = readFileSync(path.join(here, "..", "electron-builder.yml"), "utf8");

test("artefakty sa volajú lawoss-, nie legalwork-", () => {
  const line = config.split("\n").find((row) => row.trim().startsWith("artifactName:"));
  assert.ok(line, "electron-builder.yml musí definovať artifactName");
  assert.match(line, /lawoss-\$\{os\}-\$\{arch\}-\$\{version\}\.\$\{ext\}/);
  assert.doesNotMatch(line, /legalwork-/);
});
