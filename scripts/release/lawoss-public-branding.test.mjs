import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("stable release automation uses LAWOSS public branding and fork download links", () => {
  const workflow = read(".github/workflows/release-macos-aarch64.yml");
  assert.match(workflow, /RELEASE_NAME="LAWOSS \$TAG"/);
  assert.match(workflow, /releases\/download\/\$\{TAG\}/);
  assert.match(workflow, /lawoss-mac-arm64-\$\{VERSION\}\.dmg/);
  assert.doesNotMatch(workflow, /eigenweltlabs\.com\/legalwork/);
});

test("alpha workflows publish LAWOSS assets from the fork", () => {
  for (const path of [
    ".github/workflows/alpha-macos-aarch64.yml",
    ".github/workflows/alpha-windows-x64.yml",
  ]) {
    const workflow = read(path);
    assert.match(workflow, /LAWOSS Alpha/);
    assert.match(
      workflow,
      /https:\/\/github\.com\/Omni-Legal-Products\/lawoss\/releases\/download/,
    );
    assert.match(workflow, /lawoss-/);
    assert.doesNotMatch(
      workflow,
      /https:\/\/github\.com\/eigenweltlabs\/legalwork\/releases\/download/,
    );
  }
});

test("Electron packaging exposes LAWOSS filenames while preserving update identity", () => {
  const builder = read("apps/desktop/electron-builder.yml");
  const signpath = read("scripts/release/apply-signpath-windows-artifact.mjs");
  assert.match(builder, /productName: LAWOSS/);
  assert.match(
    builder,
    /artifactName: lawoss-\$\{os\}-\$\{arch\}-\$\{version\}\.\$\{ext\}/,
  );
  assert.match(builder, /appId: com\.eigenweltlabs\.legalwork/);
  assert.match(builder, /schemes:\s*\n\s*- legalwork/);
  assert.match(signpath, /\^lawoss-win-x64-/);
});

test("download statistics target the LAWOSS fork and recognize LAWOSS installers", () => {
  const stats = read("scripts/release/report-download-stats.mjs");
  assert.match(stats, /const REPO = "Omni-Legal-Products\/lawoss"/);
  assert.match(stats, /\^\(\?:lawoss\|legalwork\)-\(mac\|win\|linux\)/);
});
