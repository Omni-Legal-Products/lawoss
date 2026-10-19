import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syntheticHostConfig } from "../test-support/host-config.js";
import { protectedGuestBundleFactory } from "./bundle.js";

test("protected generation refuses a missing or self-declared runtime before creating a worker", async () => {
  const {root, config} = await syntheticHostConfig();
  const runtime = await mkdtemp(join(tmpdir(), "protected-assets-refusal-"));
  try {
    const create = protectedGuestBundleFactory(config, {runtimeDirectory: runtime});
    await expect(create({modelId: "synthetic", operationId: "synthetic"})).rejects.toMatchObject({code: "protected_runtime_unavailable"});
    await writeFile(join(runtime, "manifest.json"), JSON.stringify({version: 1, architecture: "aarch64", files: {}}));
    await expect(create({modelId: "synthetic", operationId: "synthetic"})).rejects.toMatchObject({code: "protected_runtime_unavailable"});
  } finally {await rm(runtime, {recursive: true}); await rm(root, {recursive: true});}
});

// The optional reviewed binary keeps routine unit tests small. Stub guest files
// exercise only the installed bundle loader, never claim boot/package acceptance.
test.skipIf(!process.env.LAWOSS_PROTECTED_TEST_ENGINE)("restored document bundles bind the exact private checkpoint and refuse changed snapshot bytes", async () => {
  const {createHash} = await import("node:crypto");
  const {copyFile, mkdir, readFile} = await import("node:fs/promises");
  const {default: pins} = await import("./engine-pins.json", {with: {type: "json"}});
  const {root, config} = await syntheticHostConfig();
  const runtime = join(root, "runtime"); await mkdir(runtime);
  const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
  const architecture = process.arch === "arm64" ? "arm64" : "x64", pin = pins.architectures[architecture];
  const snapshot = join(root, "saved.sqlite"), checkpointBytes = Buffer.from("SQLite format 3\0SYNTHETIC-CHECKPOINT");
  await writeFile(snapshot, checkpointBytes);
  await copyFile(process.env.LAWOSS_PROTECTED_TEST_ENGINE!, join(runtime, "protected-opencode"));
  const manifest = {schemaVersion: 1, engineVersion: pins.engineVersion, architecture, repository: pins.repository, releaseId: pins.releaseId,
    asset: {id: pin.id, sha256: pin.sha256}, binary: {sha256: pin.binarySha256, size: pin.binarySize},
    versionProof: {version: pins.engineVersion, binarySha256: pin.binarySha256, environment: "linux-bookworm-guest"}};
  await writeFile(join(runtime, "protected-opencode-manifest.json"), JSON.stringify(manifest));
  for (const name of ["kernel", "initrd.gz", "protected-engine.mjs", "plugin.mjs"]) await writeFile(join(runtime, name), `SYNTHETIC LOADER FIXTURE ${name}`);
  const files: Record<string, string> = {};
  for (const name of ["protected-opencode", "protected-opencode-manifest.json", "kernel", "initrd.gz", "protected-engine.mjs"]) files[name] = digest(await readFile(join(runtime, name)));
  await writeFile(join(runtime, "manifest.json"), JSON.stringify({version: 1, architecture: architecture === "arm64" ? "aarch64" : "x86_64", files}));
  const create = protectedGuestBundleFactory(config, {runtimeDirectory: runtime, pluginPath: join(runtime, "plugin.mjs")});
  let bundle: Awaited<ReturnType<typeof create>> | undefined;
  try {
    const checkpoint = {path: snapshot, sha256: digest(checkpointBytes)};
    bundle = await create({modelId: "synthetic", operationId: "synthetic", checkpoint});
    expect(await readFile(join(bundle.directory, "snapshot.sqlite"))).toEqual(checkpointBytes);
    expect(JSON.parse(await readFile(join(bundle.directory, "config.json"), "utf8")).checkpointSha256).toBe(checkpoint.sha256);
    expect(await bundle.currentBinding!()).toMatchObject({checkpointSha256: checkpoint.sha256});
    await writeFile(snapshot, "CHANGED");
    await expect(create({modelId: "synthetic", operationId: "synthetic", checkpoint})).rejects.toMatchObject({code: "protected_runtime_unavailable"});
  } finally {await bundle?.dispose?.(); await rm(root, {recursive: true});}
});
