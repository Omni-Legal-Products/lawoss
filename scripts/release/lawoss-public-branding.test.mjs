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
  assert.match(workflow, /lawoss-linux-x64-\$\{VERSION\}\.AppImage/);
  assert.doesNotMatch(workflow, /lawoss-linux-x86_64-\$\{VERSION\}\.AppImage/);
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
  const main = read("apps/desktop/electron/main.mjs");
  const updater = read("apps/desktop/electron/updater.mjs");
  assert.match(builder, /productName: LAWOSS/);
  assert.match(
    builder,
    /artifactName: lawoss-\$\{os\}-\$\{arch\}-\$\{version\}\.\$\{ext\}/,
  );
  assert.match(builder, /appId: com\.eigenweltlabs\.legalwork/);
  assert.match(builder, /schemes:\s*\n\s*- legalwork/);
  assert.match(signpath, /\^lawoss-win-x64-/);
  assert.match(
    main,
    /const APP_NAME =\s*\n\s*process\.env\.LEGALWORK_ELECTRON_APP_NAME\?\.trim\(\) \|\|\s*\n\s*\(isDevMode \? "LAWOSS - Dev" : "LAWOSS"\)/,
  );
  assert.match(
    main,
    /const RELEASE_PAGE_URL = "https:\/\/github\.com\/Omni-Legal-Products\/lawoss\/releases\/latest"/,
  );
  assert.doesNotMatch(
    updater,
    /github\.com\/eigenweltlabs\/legalwork\/releases/,
  );
});

test("download statistics target the LAWOSS fork and recognize LAWOSS installers", () => {
  const stats = read("scripts/release/report-download-stats.mjs");
  assert.match(stats, /const REPO = "Omni-Legal-Products\/lawoss"/);
  assert.match(stats, /\^\(\?:lawoss\|legalwork\)-\(mac\|win\|linux\)/);
});

test("application update and distribution URLs target the LAWOSS fork", () => {
  const paths = [
    "apps/app/src/app/lib/electron-alpha.ts",
    "apps/app/src/app/lib/release-channels.ts",
    "apps/app/src/react-app/shell/loading-overlay.tsx",
    "apps/app/src/react-app/design-system/web-unavailable-surface.tsx",
    "apps/orchestrator/scripts/postinstall.mjs",
    "apps/orchestrator/src/cli.ts",
    "apps/orchestrator/README.md",
    "apps/opencode-router/install.sh",
    "apps/opencode-router/README.md",
    "apps/server/package.json",
    "apps/orchestrator/package.json",
    "apps/opencode-router/package.json",
    ".github/ISSUE_TEMPLATE/bug.yml",
  ];

  for (const path of paths) {
    const source = read(path);
    assert.doesNotMatch(
      source,
      /https?:\/\/(?:raw\.githubusercontent\.com\/)?eigenweltlabs\/legalwork/,
    );
    assert.doesNotMatch(
      source,
      /https?:\/\/github\.com\/eigenweltlabs\/legalwork/,
    );
    assert.doesNotMatch(source, /https:\/\/legalwork\.app/);
  }

  for (const path of [
    "apps/app/src/app/lib/electron-alpha.ts",
    "apps/app/src/app/lib/release-channels.ts",
    "apps/orchestrator/scripts/postinstall.mjs",
    "apps/orchestrator/src/cli.ts",
  ]) {
    assert.match(read(path), /Omni-Legal-Products\/lawoss/);
  }
});
