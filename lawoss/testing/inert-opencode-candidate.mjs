// LAWOSS v2: desktop doctor fixtures run with a prepared derivative selection. Upstream v0.3.0
// verifies every engine path against that pin before probing it, so an arbitrary inert file is
// refused. These fixtures register an inert, never-executed candidate through the same validation
// path as packages/opencode-release/build/validation-preload.mjs. Spawn calls stay mocked.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { opencodeRelease, opencodeReleaseTarget } from "../../packages/opencode-release/index.mjs";
import { registerOpencodeCandidateForValidation, verifyOpencodeCandidate } from "../../packages/opencode-release/candidate.mjs";
import recipe from "../../packages/opencode-release/build/recipe.json" with { type: "json" };

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

/** Returns the canonical path of a registered inert candidate binary inside `root`. */
export async function registerInertOpencodeCandidate(root, content = "Inert diagnostic fixture; never executable") {
  const target = opencodeReleaseTarget();
  const directory = path.join(root, "inert-opencode-candidate");
  const filename = target.startsWith("windows-") ? "opencode.exe" : "opencode";
  const binary = Buffer.from(content);
  const provenance = `${JSON.stringify({ ...recipe, target, officialBase: opencodeRelease.packages[target], sourceDateEpoch: "1770000000",
    compiler: { version: recipe.toolchain.bun, sha256: recipe.toolchain.executables["darwin-arm64"].sha256 },
    binary: { filename, sha256: sha256(binary), signing: "test-fixture-only" } })}\n`;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), binary);
  await writeFile(path.join(directory, "provenance.json"), provenance);
  const descriptor = await verifyOpencodeCandidate({ directory, provenanceSha256: sha256(provenance) });
  await registerOpencodeCandidateForValidation(descriptor);
  return descriptor.path;
}
