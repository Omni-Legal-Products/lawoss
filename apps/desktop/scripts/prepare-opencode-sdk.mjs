import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function dependencyDirectory(from, name) {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", name);
    try { return await realpath(candidate); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (dirname(directory) === directory) throw new Error(`Missing build dependency: ${name}`);
  }
}

/** Copy the installed, locked dependency graph, never run a package manager at app startup. */
export async function stageOpencodeSdk({ sourcePackage, destination, expectedVersion }) {
  const packages = new Map();
  async function collect(source) {
    const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    const previous = packages.get(manifest.name);
    if (previous) {
      if (previous.manifest.version !== manifest.version) throw new Error(`Conflicting SDK dependency versions: ${manifest.name}`);
      return;
    }
    packages.set(manifest.name, { source, manifest });
    for (const name of Object.keys(manifest.dependencies ?? {})) await collect(await dependencyDirectory(source, name));
  }
  await collect(await realpath(sourcePackage));
  const sdk = packages.get("@opencode-ai/plugin");
  if (!sdk || sdk.manifest.version !== expectedVersion) throw new Error(`OpenCode plugin SDK must match engine ${expectedVersion}`);
  await rm(destination, { recursive: true, force: true });
  await mkdir(join(destination, "node_modules"), { recursive: true });
  for (const [name, { source }] of packages) {
    await cp(source, join(destination, "node_modules", name), {
      recursive: true, dereference: true,
      filter: (path) => path === source || !path.slice(source.length + 1).split(/[\\/]/).includes("node_modules"),
    });
  }
  // Optional native accelerators and optional TUI peers are not required by the
  // plugin API. Omit them so this pure-JavaScript tree works on every target OS.
  await writeFile(join(destination, "package.json"), JSON.stringify({
    private: true, dependencies: { "@opencode-ai/plugin": expectedVersion },
  }, null, 2) + "\n");
  return { version: expectedVersion, packages: packages.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const constants = JSON.parse(await readFile(join(repoRoot, "constants.json"), "utf8"));
  const result = await stageOpencodeSdk({
    sourcePackage: join(repoRoot, "apps/server/node_modules/@opencode-ai/plugin"),
    destination: join(repoRoot, "apps/desktop/resources/opencode-sdk"),
    expectedVersion: constants.opencodeVersion.replace(/^v/, ""),
  });
  console.log(`Bundled OpenCode plugin SDK ${result.version} (${result.packages} packages).`);
}
