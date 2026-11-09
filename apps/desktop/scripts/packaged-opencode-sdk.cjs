const { readFileSync } = require("node:fs");
const path = require("node:path");

// Run against copied resources before signing, and again before startup smoke
// tests: opening the renderer does not prove the engine can start.
function assertPackagedOpencodeSdk(resources) {
  const bundle = path.join(resources, "opencode-sdk");
  const root = JSON.parse(readFileSync(path.join(bundle, "package.json"), "utf8"));
  const checked = new Set();
  function check(name) {
    if (checked.has(name)) return;
    checked.add(name);
    const file = path.join(bundle, "node_modules", name, "package.json");
    let manifest;
    try { manifest = JSON.parse(readFileSync(file, "utf8")); }
    catch (cause) { throw new Error(`Missing packaged OpenCode SDK dependency: ${name}`, { cause }); }
    if (manifest.name !== name) throw new Error(`Invalid packaged OpenCode SDK dependency: ${name}`);
    if (name === "@opencode-ai/plugin" && manifest.version !== root.dependencies[name]) {
      throw new Error("Packaged OpenCode plugin SDK version does not match its manifest");
    }
    for (const dependency of Object.keys(manifest.dependencies ?? {})) check(dependency);
  }
  check("@opencode-ai/plugin");
  return bundle;
}

module.exports = { assertPackagedOpencodeSdk };
