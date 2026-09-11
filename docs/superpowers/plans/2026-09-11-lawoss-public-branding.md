# LAWOSS Public Branding Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the published LAWOSS desktop distribution and release automation use LAWOSS branding and the LAWOSS GitHub repository without changing technical identifiers that preserve existing installations.

**Architecture:** Change only public distribution metadata, release notes, installer filename patterns, alpha feed URLs, and release statistics repository targeting. Keep internal workspace package names, sidecar names, environment variables, IPC identifiers, the existing Electron `appId`, and the `legalwork://` scheme for backward compatibility.

**Tech Stack:** GitHub Actions YAML, Electron Builder YAML, Node.js ESM tests, pnpm workspace.

**Spec:** User-approved phase 1 scope in the task conversation on 2026-09-11.

## Global Constraints

- Every change must go through a pull request; do not push directly to `dev`.
- Release distribution must target `Omni-Legal-Products/lawoss`.
- Public product and release labels must use `LAWOSS`, not `LegalWork`.
- Existing `appId`, `legalwork://` scheme, internal `@legalwork/*` package names, sidecar names, and environment variables remain unchanged in this phase.
- Update `PATCHES.md` for every modified inherited upstream file.

---

### Task 1: Add a failing public-branding regression test

**Files:**
- Create: `scripts/release/lawoss-public-branding.test.mjs`

**Interfaces:**
- Consumes: release and packaging configuration files from the repository root.
- Produces: executable Node test assertions for public LAWOSS distribution identity and backward-compatible technical identifiers.

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

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
    assert.match(workflow, /https:\/\/github\.com\/Omni-Legal-Products\/lawoss\/releases\/download/);
    assert.match(workflow, /lawoss-/);
    assert.doesNotMatch(workflow, /https:\/\/github\.com\/eigenweltlabs\/legalwork\/releases\/download/);
  }
});

test("Electron packaging exposes LAWOSS filenames while preserving update identity", () => {
  const builder = read("apps/desktop/electron-builder.yml");
  assert.match(builder, /productName: LAWOSS/);
  assert.match(builder, /artifactName: lawoss-\$\{os\}-\$\{arch\}-\$\{version\}\.\$\{ext\}/);
  assert.match(builder, /appId: com\.eigenweltlabs\.legalwork/);
  assert.match(builder, /schemes:\s*\n\s*- legalwork/);
});

test("download statistics target the LAWOSS fork and recognize LAWOSS installers", () => {
  const stats = read("scripts/release/report-download-stats.mjs");
  assert.match(stats, /const REPO = "Omni-Legal-Products\/lawoss"/);
  assert.match(stats, /\^lawoss-\(mac\|win\|linux\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/release/lawoss-public-branding.test.mjs`

Expected: FAIL because the current stable and alpha workflows still use LegalWork labels/URLs and the current artifact prefix is `legalwork-`.

- [ ] **Step 3: Commit**

```bash
git add scripts/release/lawoss-public-branding.test.mjs
git commit -m "test: overiť verejnú identitu LAWOSS distribúcie"
```

### Task 2: Rename stable and alpha distribution metadata

**Files:**
- Modify: `.github/workflows/release-macos-aarch64.yml`
- Modify: `.github/workflows/alpha-macos-aarch64.yml`
- Modify: `.github/workflows/alpha-windows-x64.yml`
- Modify: `.github/workflows/ci-tests.yml`
- Modify: `.github/workflows/telegram-notify.yml`
- Modify: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/package.json`
- Modify: `scripts/release/apply-signpath-windows-artifact.mjs`

**Interfaces:**
- Consumes: the existing GitHub Actions release jobs and Electron Builder packaging configuration.
- Produces: LAWOSS-labelled release titles, GitHub-fork download links, `lawoss-*` installer assets, and a LAWOSS-labelled CI notification source while preserving internal build filters and technical identifiers.

- [ ] **Step 1: Change stable release defaults and direct GitHub asset links**

Use `LAWOSS` in the default release title and body. Derive `VERSION="${TAG#v}"` and `RELEASE_DOWNLOAD_BASE="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/releases/download/${TAG}"`, then link the five installer filenames using the `lawoss-` prefix. Replace the upstream `eigenweltlabs.com/legalwork` links. Update stable Windows staging, Electron asset globs, and SignPath signed-installer discovery from `legalwork-*` to `lawoss-*`, including the temporary unsigned artifact label.

- [ ] **Step 2: Change alpha titles and fork updater pointers**

Use `LAWOSS Alpha` in macOS and Windows alpha titles/bodies. Replace the hardcoded upstream release base URL with `https://github.com/Omni-Legal-Products/lawoss/releases/download/${releaseTag}`. Update only installer filename regexes/globs from `legalwork-` to `lawoss-`; keep `legalwork-server` and `legalwork-orchestrator` sidecar names unchanged because they are internal package identities.

- [ ] **Step 3: Change packaging-facing labels**

In `electron-builder.yml`, change the protocol display name and user-facing macOS permission descriptions to LAWOSS, change `artifactName` to `lawoss-${os}-${arch}-${version}.${ext}`, and leave `appId` and the `legalwork` scheme unchanged. In `apps/desktop/package.json`, change the public description and author name to LAWOSS/Omni-Legal-Products without inventing an email address.

- [ ] **Step 4: Keep Telegram workflow names aligned**

Rename the CI workflow display name from `LegalWork Tests` to `LAWOSS Tests` and update the corresponding `workflow_run` subscription in `telegram-notify.yml`; do not add routine push notifications beyond the existing event policy.

- [ ] **Step 5: Run the focused test to verify it passes**

Run: `node --test scripts/release/lawoss-public-branding.test.mjs`

Expected: PASS with four tests and zero failures.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release-macos-aarch64.yml .github/workflows/alpha-macos-aarch64.yml .github/workflows/alpha-windows-x64.yml .github/workflows/ci-tests.yml .github/workflows/telegram-notify.yml apps/desktop/electron-builder.yml apps/desktop/package.json
git commit -m "chore: odstrániť upstream identitu z LAWOSS distribúcie"
```

### Task 3: Point release statistics at the fork

**Files:**
- Modify: `scripts/release/report-download-stats.mjs`
- Modify: `.github/workflows/download-stats.yml`

**Interfaces:**
- Consumes: GitHub release and traffic APIs for the repository running the workflow.
- Produces: release and traffic snapshots for `Omni-Legal-Products/lawoss`, with LAWOSS installer classification and existing environment-variable compatibility.

- [ ] **Step 1: Update the repository and installer classifier**

Set `REPO` to `Omni-Legal-Products/lawoss` and classify new `lawoss-` installer filenames. Keep a compatibility branch for legacy `legalwork-` assets only if needed to preserve historical statistics; do not use the legacy prefix for new artifacts.

- [ ] **Step 2: Update workflow comments**

Describe the PostHog variables as LAWOSS statistics while leaving the existing `LEGALWORK_*` variable names as compatibility aliases so configured repository variables do not silently stop working.

- [ ] **Step 3: Run the statistics dry run**

Run: `node scripts/release/report-download-stats.mjs --dry-run`

Expected: the script reaches the GitHub API using `Omni-Legal-Products/lawoss` and prints `Dry run — nothing sent.`; network/API failure must be reported separately from code verification.

- [ ] **Step 4: Commit**

```bash
git add scripts/release/report-download-stats.mjs .github/workflows/download-stats.yml
git commit -m "fix: smerovať release štatistiky na LAWOSS fork"
```

### Task 4: Record inherited-file patches and run full verification

**Files:**
- Modify: `PATCHES.md`

**Interfaces:**
- Consumes: the final diff and the repository's downstream patch ledger.
- Produces: documented LAWOSS branding overrides and verified YAML/JSON/release checks ready for PR review.

- [ ] **Step 1: Add/update the PATCHES.md rows**

Record the release workflow, alpha workflows, CI/Telegram workflow naming, Electron Builder public metadata, desktop package metadata, download statistics script, and download-stats workflow as one focused downstream change. Explicitly note that `appId`, `legalwork://`, internal package names, sidecar names, and environment variables remain unchanged for compatibility.

- [ ] **Step 2: Run JSON and YAML-adjacent syntax checks**

Run: `node --check scripts/release/report-download-stats.mjs`

Run: `node --check scripts/release/lawoss-public-branding.test.mjs`

Run: `pnpm dlx prettier@3.6.2 --check .github/workflows/release-macos-aarch64.yml .github/workflows/alpha-macos-aarch64.yml .github/workflows/alpha-windows-x64.yml .github/workflows/ci-tests.yml .github/workflows/telegram-notify.yml .github/workflows/download-stats.yml apps/desktop/electron-builder.yml apps/desktop/package.json scripts/release/report-download-stats.mjs scripts/release/lawoss-public-branding.test.mjs`

Expected: both syntax checks and the Prettier check exit 0. `PATCHES.md` retains the repository's existing compact table formatting and is checked with `git diff --check` instead of being reformatted.

- [ ] **Step 3: Run the desktop test suite and typecheck**

Run: `pnpm --filter @legalwork/desktop test`

Run: `pnpm --filter @legalwork/desktop typecheck:electron`

Expected: both commands exit 0; any pre-existing environment failure is reported with its exact output rather than treated as a pass.

- [ ] **Step 4: Review the final diff and commit**

Run: `git diff --check` and `git diff --stat origin/dev...HEAD`.

Then commit the patch ledger:

```bash
git add PATCHES.md
git commit -m "docs: evidovať LAWOSS distribučný branding"
```

- [ ] **Step 5: Push branch and open PR**

Run: `git push -u origin codex/lawoss-branding-phase1`.

Open a PR against `dev` with a title such as `chore: odstrániť upstream identitu z LAWOSS distribúcie`, explain the compatibility-preserving scope, list exact verification commands, and note that a complete `appId`/namespace migration is intentionally out of scope.
