import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveServerConfig } from "./config.js";
import { prepareManagedOpencodeDependencies } from "./managed-opencode-dependencies.js";
import { orgPolicyEngineDir } from "./org-policy-engine.js";

const roots: string[] = [];
const previous = process.env.LEGALWORK_RUNTIME_DB;
afterEach(async () => {
  if (previous === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previous;
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function setup(version = "1.18.29") {
  const root = await mkdtemp(join(tmpdir(), "managed-sdk-")); roots.push(root);
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const config = await resolveServerConfig({ configPath: join(root, "server.json"), workspaces: [] });
  config.agentSandboxEnabled = true;
  const bundle = join(root, "bundle"), sdk = join(bundle, "node_modules", "@opencode-ai/plugin");
  await mkdir(sdk, { recursive: true });
  await writeFile(join(bundle, "package.json"), JSON.stringify({ dependencies: { "@opencode-ai/plugin": "1.18.29" } }));
  await writeFile(join(sdk, "package.json"), JSON.stringify({ name: "@opencode-ai/plugin", version }));
  await writeFile(join(sdk, "index.js"), "export const sdk = true;\n");
  return { config, bundle, sdk, root, directory: join(root, "engine-home", "config", "opencode") };
}

test("an explicitly required missing SDK fails instead of allowing runtime installation", async () => {
  const { config, bundle, root } = await setup();
  await expect(prepareManagedOpencodeDependencies(config, join(root, "missing"))).rejects.toThrow("Bundled OpenCode plugin SDK is missing");
  config.agentSandboxEnabled = false;
  expect(await prepareManagedOpencodeDependencies(config, bundle)).toEqual({ seeded: false, reason: "unmanaged" });
});

test("seeding uses the real exact SDK, is repeatable and preserves custom dependencies and lock entries", async () => {
  const { config, bundle, sdk, directory } = await setup();
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "kept", dependencies: { custom: "2.0.0" }, scripts: { kept: "true" } }));
  await writeFile(join(directory, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { custom: "2.0.0" } }, "node_modules/custom": { version: "2.0.0" } } }));
  for (let iteration = 0; iteration < 2; iteration++) {
    expect((await prepareManagedOpencodeDependencies(config, bundle)).seeded).toBe(true);
    expect(await realpath(join(directory, "node_modules", "@opencode-ai/plugin"))).toBe(await realpath(sdk));
    expect(await realpath(join(orgPolicyEngineDir(config), "node_modules", "@opencode-ai/plugin"))).toBe(await realpath(sdk));
    expect(JSON.parse(await readFile(join(directory, "package.json"), "utf8"))).toMatchObject({ name: "kept", dependencies: { custom: "2.0.0" }, scripts: { kept: "true" } });
    expect(JSON.parse(await readFile(join(directory, "package-lock.json"), "utf8"))).toMatchObject({ packages: { "": { dependencies: { custom: "2.0.0" } }, "node_modules/custom": { version: "2.0.0" } } });
  }
});

test("an old managed SDK is replaced without changing other packages", async () => {
  const { config, bundle, directory, sdk } = await setup();
  const old = join(directory, "node_modules", "@opencode-ai/plugin"), other = join(directory, "node_modules", "custom");
  await mkdir(old, { recursive: true }); await mkdir(other);
  await writeFile(join(old, "package.json"), JSON.stringify({ name: "@opencode-ai/plugin", version: "0.1.0" }));
  await writeFile(join(other, "keep"), "unchanged");
  await prepareManagedOpencodeDependencies(config, bundle);
  expect(await realpath(old)).toBe(await realpath(sdk));
  expect(await readFile(join(other, "keep"), "utf8")).toBe("unchanged");
});

test("drifting bundles and malformed config fail visibly without replacing the config", async () => {
  const wrong = await setup("1.18.30");
  await expect(prepareManagedOpencodeDependencies(wrong.config, wrong.bundle)).rejects.toThrow("must match engine 1.18.29");
  const { config, bundle, directory } = await setup();
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), "broken");
  await expect(prepareManagedOpencodeDependencies(config, bundle)).rejects.toThrow();
  expect(await readFile(join(directory, "package.json"), "utf8")).toBe("broken");
});
