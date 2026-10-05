import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkPackagedServerImports, isImportable, relativeSpecifiers } from "../scripts/check-packaged-server-imports.mjs";

// LAWOSS: stráž z 5. 10. 2026. Zabalená appka nenaštartovala server, lebo
// server/dist/lawoss/chatgpt-subscription.js importoval koreňový lawoss/ cez
// relatívnu cestu, ktorá v app.asar mieri do Resources/.
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "lawoss-imports-fixture-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const serverPackage = JSON.stringify({ name: "legalwork-server", type: "module" });

test("modules that resolve inside the packaged tree pass", (t) => {
  const root = fixture({
    "app/server/package.json": serverPackage,
    "app/server/dist/a.js": 'import { b } from "./b.js";\nexport const a = b;\n',
    "app/server/dist/b.js": "export const b = 1;\n",
    "app/server/dist/a.test.js": 'import "../../../../missing.js";\n',
    "app/server/dist/cli.js": 'import { a } from "./a.js";\nthrow new Error(`entry point must not run ${a}`);\n',
    "app/server/dist/opencode-plugins/p.js": 'import "zod-is-not-here";\n',
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = checkPackagedServerImports(join(root, "app"));
  assert.deepEqual(result.failures, []);
  assert.equal(result.imported, 2);
  assert.equal(result.files, 3);
});

test("an import that leaves server/dist fails even when the checkout has the file", (t) => {
  // app/server/dist/lawoss → štyri úrovne hore je koreň fixture, kde súbor existuje.
  const root = fixture({
    "lawoss/providers/chatgpt-subscription.mjs": "export const ok = true;\n",
    "app/server/package.json": serverPackage,
    "app/server/dist/lawoss/chatgpt-subscription.js": 'import { ok } from "../../../../lawoss/providers/chatgpt-subscription.mjs";\nexport { ok };\n',
    "app/server/dist/server.js": 'import { ok } from "./lawoss/chatgpt-subscription.js";\nexport { ok };\n',
    "app/server/dist/cli.js": 'import "../../../../lawoss/okf/onboarding.mjs";\n',
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { failures } = checkPackagedServerImports(join(root, "app"));
  const byFile = (file) => failures.filter((failure) => failure.file.replaceAll("\\", "/") === file);
  assert.ok(byFile("lawoss/chatgpt-subscription.js").every((failure) => failure.code === "ERR_MODULE_NOT_FOUND"));
  assert.equal(byFile("lawoss/chatgpt-subscription.js").length, 2, "static and runtime failure");
  assert.equal(byFile("server.js")[0]?.code, "ERR_MODULE_NOT_FOUND", "importers fail too");
  assert.match(byFile("cli.js")[0]?.message ?? "", /lawoss\/okf\/onboarding\.mjs/, "entry points are checked statically");
});

test("only line-leading import statements count as static imports", () => {
  const source = [
    'import {',
    '  a,',
    '} from "./a.js";',
    'export * from "../b.js";',
    'import "./side-effect.js";',
    'const text = "import x from \'./not-an-import.js\'";',
    'import pkg from "zod";',
  ].join("\n");
  assert.deepEqual(relativeSpecifiers(source), ["./a.js", "../b.js", "./side-effect.js"]);
});

test("tests, engine plugins and entry points are not imported", () => {
  assert.equal(isImportable("server.js"), true);
  assert.equal(isImportable(join("lawoss", "triage.js")), true);
  assert.equal(isImportable("server.test.js"), false);
  assert.equal(isImportable(join("opencode-plugins", "lawoss-okf-handoff.js")), false);
  assert.equal(isImportable("cli.js"), false);
  assert.equal(isImportable("toy-ui.js"), false);
});
