import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { withFileWriteLock } from "./file-write-lock.js";
import { orgPolicyEngineDir } from "./org-policy-engine.js";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

const packageName = "@opencode-ai/plugin";
const record = z.record(z.string(), z.unknown());
const dependencies = z.record(z.string(), z.string());
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";

async function readObject(path: string) {
  const text = await readFile(path, "utf8").catch((error: unknown) => { if (missing(error)) return "{}"; throw error; });
  return record.parse(JSON.parse(text));
}

async function writeObject(path: string, value: Record<string, unknown>) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

async function ownDirectory(path: string) {
  const info = await lstat(path).catch((error: unknown) => { if (missing(error)) return null; throw error; });
  if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error(`Managed dependency directory is not a local directory: ${path}`);
  await mkdir(path, { recursive: true });
}

async function linkSdk(directory: string, source: string) {
  const modules = join(directory, "node_modules"), scope = join(modules, "@opencode-ai"), target = join(scope, "plugin");
  await ownDirectory(modules); await ownDirectory(scope);
  if (await realpath(target).catch((error: unknown) => { if (missing(error)) return null; throw error; }) === source) return;
  const existing = await lstat(target).catch((error: unknown) => { if (missing(error)) return null; throw error; });
  if (existing && !existing.isSymbolicLink()) {
    const manifest = await readObject(join(target, "package.json"));
    if (manifest.name !== packageName) throw new Error("Refusing to replace an unknown managed plugin directory");
  }
  const temporary = `${target}.${randomUUID()}.tmp`, backup = `${target}.${randomUUID()}.old`;
  await symlink(source, temporary, process.platform === "win32" ? "junction" : "dir");
  try {
    if (existing) await rename(target, backup);
    try { await rename(temporary, target); }
    catch (error) { if (existing) await rename(backup, target); throw error; }
    if (existing) await rm(backup, { recursive: true, force: true });
  } finally { await rm(temporary, { force: true }); }
}

/** Only app-owned engine configuration directories are seeded. User projects and
 * standalone OpenCode installations retain their own dependency management. */
export async function prepareManagedOpencodeDependencies(config: ServerConfig, sdkDirectory?: string) {
  if (!config.agentSandboxEnabled) return { seeded: false, reason: "unmanaged" };
  const bundle = sdkDirectory ?? (process.resourcesPath
    ? join(process.resourcesPath, "opencode-sdk")
    : fileURLToPath(new URL("../../desktop/resources/opencode-sdk", import.meta.url)));
  const source = await realpath(join(bundle, "node_modules", packageName)).catch((error: unknown) => { if (missing(error)) return null; throw error; });
  if (!source && sdkDirectory !== undefined) {
    throw new Error(`Bundled OpenCode plugin SDK is missing at ${bundle}. Repair the app installation or build the desktop resources before starting the engine.`);
  }
  // A source/CLI checkout may not have run the desktop resource build yet.
  if (!source) return { seeded: false, reason: "bundle-unavailable" };
  const manifest = await readObject(join(source, "package.json"));
  const bundled = await readObject(join(bundle, "package.json"));
  const version = z.string().regex(/^\d+\.\d+\.\d+(?:[-+].+)?$/).parse(dependencies.parse(bundled.dependencies)[packageName]);
  if (manifest.name !== packageName || manifest.version !== version) throw new Error(`Bundled OpenCode plugin SDK must match engine ${version}`);
  const home = join(runtimeStorageDir(config), "engine-home");
  const directories = [join(home, "config", "opencode"), orgPolicyEngineDir(config)];
  if (await lstat(join(home, ".opencode")).catch((error: unknown) => { if (missing(error)) return null; throw error; })) directories.push(join(home, ".opencode"));
  for (const directory of directories) {
    await ownDirectory(directory);
    await withFileWriteLock(join(directory, "package.json"), async () => {
      // Parse before changing anything. Malformed files remain available for repair.
      const current = await readObject(join(directory, "package.json"));
      const lock = await readObject(join(directory, "package-lock.json"));
      const currentDependencies = dependencies.parse(current.dependencies ?? {});
      const packages = z.record(z.string(), record).parse(lock.packages ?? {});
      const root = packages[""] ?? {};
      const rootDependencies = dependencies.parse(root.dependencies ?? {});
      const specifier = `file:${source.replaceAll("\\", "/")}`;
      await linkSdk(directory, source);
      await writeObject(join(directory, "package.json"), { ...current, dependencies: { ...currentDependencies, [packageName]: specifier } });
      await writeObject(join(directory, "package-lock.json"), {
        ...lock, lockfileVersion: 3, requires: true,
        packages: { ...packages,
          "": { ...root, dependencies: { ...rootDependencies, [packageName]: specifier } },
          [`node_modules/${packageName}`]: { resolved: source.replaceAll("\\", "/"), link: true },
          [resolve(source).replaceAll("\\", "/")]: { ...manifest, devDependencies: undefined, scripts: undefined },
        },
      });
    });
  }
  return { seeded: true, directories };
}
