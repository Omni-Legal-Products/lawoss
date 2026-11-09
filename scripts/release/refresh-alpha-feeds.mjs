import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createReleaseFeedResolver, compareVersions, RELEASE_REPOSITORY } from "../../apps/desktop/electron/release-feeds.mjs";

const { parse, stringify } = createRequire(new URL("../../apps/desktop/package.json", import.meta.url))("yaml");

export function pinManifest(text, selected) {
  const manifest = parse(text);
  if (compareVersions(manifest.version, selected.version) !== 0) throw new Error("Manifest version mismatch");
  function pin(file) {
    if (typeof file !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file) || !selected.assetNames.includes(file)) {
      throw new Error("Manifest references an unknown release asset");
    }
    return `${selected.feedUrl}/${file}`;
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error("Manifest has no files");
  manifest.files = manifest.files.map((file) => ({ ...file, url: pin(file.url) }));
  if (manifest.path) manifest.path = pin(manifest.path);
  return stringify(manifest);
}

async function refresh() {
  if (process.env.GITHUB_REPOSITORY !== RELEASE_REPOSITORY) throw new Error("Unexpected release repository");
  const resolve = createReleaseFeedResolver({ token: process.env.GH_TOKEN });
  const directory = mkdtempSync(join(tmpdir(), "legalwork-alpha-feeds-"));
  try {
    for (const [platform, arch, tag] of [
      ["darwin", "arm64", "alpha-macos-latest"],
      ["win32", "x64", "alpha-windows-latest"],
      ["win32", "arm64", "alpha-windows-latest"],
    ]) {
      const selected = await resolve("alpha", platform, arch);
      if (!selected) continue;
      const response = await fetch(`${selected.feedUrl}/${selected.manifest}`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Cannot read ${selected.tag}/${selected.manifest}`);
      const manifest = pinManifest(await response.text(), selected);
      // This workflow is the only rolling-feed writer. Every invocation
      // recomputes the newest eligible release, never the triggering run.
      const existing = await fetch(`https://github.com/${RELEASE_REPOSITORY}/releases/download/${tag}/${selected.manifest}`, { signal: AbortSignal.timeout(30_000) });
      if (existing.ok) {
        const previous = await existing.text();
        const comparison = compareVersions(parse(previous).version, selected.version);
        if (comparison > 0 || previous === manifest) continue;
      } else if (existing.status !== 404) {
        throw new Error(`Cannot read existing alpha pointer (${existing.status})`);
      }
      // Only these existing internal alpha pointers are ever published here.
      // Versioned regular releases and their Pre-release flags are untouched.
      execFileSync("gh", ["release", "view", tag, "--repo", RELEASE_REPOSITORY], { stdio: "ignore" });
      const file = join(directory, selected.manifest);
      writeFileSync(file, manifest);
      execFileSync("gh", ["release", "upload", tag, file, "--repo", RELEASE_REPOSITORY, "--clobber"], { stdio: "inherit" });
      console.log(`${tag}/${selected.manifest} -> ${selected.tag}`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await refresh();
