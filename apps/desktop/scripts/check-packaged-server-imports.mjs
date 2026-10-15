import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder"));
const libRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const { extractFile, listPackage } = libRequire("@electron/asar");
const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { preProcessFile } = serverRequire("typescript");

export function findMissingServerImports(archive) {
  const files = new Set(listPackage(archive).map(file => file.replaceAll("\\", "/").replace(/^\//, "")));
  const missing = [];
  for (const file of files) {
    if (!file.startsWith("server/dist/") || file.startsWith("server/dist/opencode-plugins/") || !file.endsWith(".js") || file.endsWith(".test.js")) continue;
    const source = extractFile(archive, file).toString("utf8");
    for (const { fileName: specifier } of preProcessFile(source, true, true).importedFiles) {
      if (!specifier.startsWith(".")) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (!files.has(target)) missing.push({ file, specifier });
    }
  }
  return missing;
}

export function assertPackagedServerImports(archive) {
  const missing = findMissingServerImports(archive);
  assert.deepEqual(missing, [], `Packaged server imports missing files: ${JSON.stringify(missing)}`);
  console.log("PASS: packaged server relative imports exist inside app.asar");
}
