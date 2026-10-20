import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { sandboxResources } from "../../agent-sandbox/vm.js";
import { ApiError } from "../../errors.js";
import { runtimeStorageDir } from "../../runtime-opencode-config-store.js";
import type { ServerConfig } from "../../types.js";
import type { ProtectedGuestBundle } from "./runtime.js";
import pins from "./engine-pins.json" with {type: "json"};

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const runtimeSchema = z.object({ version: z.literal(1), architecture: z.enum(["aarch64", "x86_64"]), files: z.record(z.string(), hashSchema) });
async function hashFile(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error("Protected runtime assets must be regular files.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function measuredFile(path: string) {
  let previous: string | undefined, result: string | undefined;
  return async () => {
    const info = await lstat(path, {bigint: true});
    if (!info.isFile()) throw new Error("Protected runtime assets must be regular files.");
    const identity = [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":");
    if (identity !== previous || !result) {result = await hashFile(path); previous = identity;}
    return result;
  };
}

/** Installed applications consume only measured packaged assets, never download an engine. */
export function protectedGuestBundleFactory(config: ServerConfig, options: {runtimeDirectory?: string; pluginPath?: string} = {}) {
  return async (input: {modelId: string; operationId: string; checkpoint?: {path: string; sha256: string}}): Promise<ProtectedGuestBundle> => {
    let scratch: string | undefined;
    try {
      const directory = options.runtimeDirectory ?? sandboxResources();
      const manifestPath = join(directory, "manifest.json");
      const manifest = runtimeSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
      const architecture = manifest.architecture === "aarch64" ? "arm64" : "x64", pin = pins.architectures[architecture];
      if (architecture !== process.arch) throw new Error("The protected guest architecture does not match this application.");
      const engineManifest = JSON.parse(await readFile(join(directory, "protected-opencode-manifest.json"), "utf8"));
      if (engineManifest.schemaVersion !== 1 || engineManifest.engineVersion !== pins.engineVersion || engineManifest.architecture !== architecture
        || engineManifest.repository !== pins.repository || engineManifest.releaseId !== pins.releaseId
        || engineManifest.asset?.id !== pin.id || engineManifest.asset?.sha256 !== pin.sha256
        || engineManifest.binary?.sha256 !== pin.binarySha256 || engineManifest.binary?.size !== pin.binarySize
        || engineManifest.versionProof?.version !== pins.engineVersion || engineManifest.versionProof?.binarySha256 !== pin.binarySha256
        || engineManifest.versionProof?.environment !== "linux-bookworm-guest") throw new Error("The reviewed guest engine or execution proof is missing.");
      for (const name of ["protected-opencode", "protected-opencode-manifest.json", "protected-engine.mjs", "kernel", "initrd.gz"]) {
        if (!manifest.files[name] || await hashFile(join(directory, name)) !== manifest.files[name]) throw new Error("The protected runtime manifest does not match its assets.");
      }
      if (manifest.files["protected-opencode"] !== pin.binarySha256) throw new Error("The protected engine is not the reviewed binary.");
      const plugin = options.pluginPath ?? fileURLToPath(new URL("./document-plugin.mjs", import.meta.url));
      const pluginHash = await hashFile(plugin);
      const parent = join(runtimeStorageDir(config), "protected-documents");
      await mkdir(parent, {recursive: true, mode: 0o700});
      scratch = await mkdtemp(join(parent, "operation-"));
      const bundleDirectory = join(scratch, "bundle"), emptyDirectory = join(scratch, "empty");
      await mkdir(bundleDirectory, {mode: 0o700}); await mkdir(emptyDirectory, {mode: 0o700});
      await copyFile(join(directory, "protected-opencode"), join(bundleDirectory, "opencode"));
      await copyFile(join(directory, "protected-engine.mjs"), join(bundleDirectory, "protected-engine.mjs"));
      await copyFile(plugin, join(bundleDirectory, "plugin.mjs"));
      if (input.checkpoint) {
        const info = await lstat(input.checkpoint.path);
        if (!info.isFile() || info.size > 16 * 1024 * 1024 || !hashSchema.safeParse(input.checkpoint.sha256).success
          || await hashFile(input.checkpoint.path) !== input.checkpoint.sha256) throw new Error("The private checkpoint is invalid.");
        await copyFile(input.checkpoint.path, join(bundleDirectory, "snapshot.sqlite"));
        await chmod(join(bundleDirectory, "snapshot.sqlite"), 0o400);
        if (await hashFile(join(bundleDirectory, "snapshot.sqlite")) !== input.checkpoint.sha256) throw new Error("The checkpoint changed while being copied.");
      }
      await writeFile(join(bundleDirectory, "config.json"), JSON.stringify({...(input.checkpoint ? {checkpointSha256: input.checkpoint.sha256} : {}), model: {id: input.modelId, context: 100000, output: 8000, variants: {high: {}}}}), {mode: 0o400});
      for (const name of ["opencode", "protected-engine.mjs", "plugin.mjs"]) await chmod(join(bundleDirectory, name), 0o400);
      const readers = { engineSha256: measuredFile(join(bundleDirectory, "opencode")), runtimeManifestSha256: measuredFile(manifestPath),
        pluginSha256: measuredFile(join(bundleDirectory, "plugin.mjs")), configSha256: measuredFile(join(bundleDirectory, "config.json")),
        launcherSha256: measuredFile(join(bundleDirectory, "protected-engine.mjs")) };
      const checkpointReader = input.checkpoint ? measuredFile(join(bundleDirectory, "snapshot.sqlite")) : undefined;
      const currentBinding = async () => ({ ...(checkpointReader ? {checkpointSha256: await checkpointReader()} : {}), engineSha256: await readers.engineSha256(), runtimeManifestSha256: await readers.runtimeManifestSha256(),
        pluginSha256: await readers.pluginSha256(), configSha256: await readers.configSha256(), launcherSha256: await readers.launcherSha256() });
      const measurements = await currentBinding();
      if (measurements.engineSha256 !== pin.binarySha256 || measurements.pluginSha256 !== pluginHash || measurements.launcherSha256 !== manifest.files["protected-engine.mjs"])
        throw new Error("The private guest bundle changed while it was copied.");
      const owned = scratch;
      return {directory: bundleDirectory, emptyDirectory, measurements, currentBinding, dispose: () => rm(owned, {recursive: true, force: true})};
    } catch {
      if (scratch) await rm(scratch, {recursive: true, force: true});
      throw new ApiError(409, "protected_runtime_unavailable", "The measured protected document runtime is unavailable. Repair the installed package; no host-engine fallback is permitted.");
    }
  };
}
