#!/usr/bin/env node
/**
 * release:prepare [--set x.y.z-lawoss.N]
 *
 * Tags the current dev HEAD for release — no version-bump commit. The git tag
 * is the single source of truth for the version; CI stamps it into the build
 * (scripts/release/apply-version.mjs), so dev stays untouched and protected.
 *
 * LAWOSS releases are versioned `v<upstream>-lawoss.<n>` (AGENTS.md): the
 * base is the merged upstream release, `n` counts LAWOSS builds on top of it.
 * A bare vX.Y.Z would collide with the upstream tag of the same name, which
 * this checkout also carries. Without --set the next version keeps the base
 * of the latest v*-lawoss.* tag reachable from HEAD and bumps `n`; a new
 * upstream base is always set explicitly after a sync.
 *
 * Flags:
 *   --set x.y.z-lawoss.N  Use an explicit version instead of bumping `n`.
 *   --dry-run    Print what would happen without mutating anything.
 *   --ci         Skip interactive-safety checks (branch, clean-tree).
 */
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const args = process.argv.slice(2);

const dryRun = args.includes("--dry-run");
const ci = args.includes("--ci");
const setIndex = args.indexOf("--set");
const explicitVersion = setIndex >= 0 ? (args[setIndex + 1] ?? "") : null;

const log = (msg) => console.log(`  ${msg}`);
const heading = (msg) => console.log(`\n▸ ${msg}`);
const success = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
};

const run = (cmd, opts = {}) => {
  if (dryRun && !opts.readOnly) {
    log(`[dry-run] ${cmd}`);
    return "";
  }
  try {
    return execSync(cmd, { cwd: root, encoding: "utf8", stdio: opts.stdio ?? "pipe" }).trim();
  } catch (err) {
    if (opts.allowFail) return "";
    fail(`Command failed: ${cmd}\n${err.stderr || err.message}`);
  }
};

// ── Step 1: Verify state ────────────────────────────────────────────
heading("Checking git state");

if (!ci) {
  const branch = run("git rev-parse --abbrev-ref HEAD", { readOnly: true });
  if (branch !== "dev") fail(`Must be on 'dev' branch (currently on '${branch}')`);
  success(`On branch ${branch}`);
}

const dirty = run("git status --porcelain", { readOnly: true });
if (dirty && !ci) fail(`Working tree is dirty:\n${dirty}`);
success(dirty ? "Working tree dirty (allowed with --ci)" : "Working tree clean");

heading("Syncing with origin/dev");
// Only LAWOSS release tags: `--tags` would try to overwrite the upstream
// tags this checkout keeps for syncs (origin's legacy v0.1.14 differs from
// upstream's) and abort the fetch.
run("git fetch origin dev", { readOnly: true });
const lawossTagRefs = run('git ls-remote --tags origin "refs/tags/v*-lawoss.*"', { readOnly: true, allowFail: true })
  .split("\n")
  .map((line) => line.split("\t")[1])
  .filter((ref) => ref && !ref.endsWith("^{}"));
if (lawossTagRefs.length > 0) {
  run(`git fetch origin ${lawossTagRefs.map((ref) => `${ref}:${ref}`).join(" ")}`, { readOnly: true });
}
success(`Fetched ${lawossTagRefs.length} LAWOSS release tag(s) from origin`);
const behind = run("git rev-list HEAD..origin/dev --count", { readOnly: true });
if (behind !== "0" && !dryRun) {
  log(`Behind origin/dev by ${behind} commits — pulling…`);
  run("git pull --rebase origin dev");
}
// The tag must point at a commit that is already on origin/dev — the
// release workflow rejects tags that are not (verify-tag.mjs), and pushing
// extra commits directly to dev is blocked by branch protection anyway.
const ahead = run("git rev-list origin/dev..HEAD --count", { readOnly: true });
if (ahead !== "0" && !ci) {
  fail(
    `HEAD is ${ahead} commits ahead of origin/dev.\n` +
    "  Releases tag commits that already landed on origin/dev — merge your work via a PR first.",
  );
}
success(ahead === "0" ? "HEAD matches origin/dev" : "HEAD ahead of origin/dev (allowed with --ci)");

// ── Step 2: Resolve next version ────────────────────────────────────
heading("Resolving next version");

// `n` has no leading zero: apply-version.mjs rejects such identifiers because
// pnpm would not treat the stamped version as valid semver.
const lawossPattern = /^(\d+\.\d+\.\d+)-lawoss\.([1-9]\d*)$/;

let version;
if (explicitVersion !== null) {
  if (!lawossPattern.test(explicitVersion)) {
    fail(`--set requires a version like 0.1.21-lawoss.1 (got '${explicitVersion || "nothing"}')`);
  }
  version = explicitVersion;
  success(`Using explicit version ${version}`);
} else {
  const latestTag = run('git describe --tags --match "v*-lawoss.*" --abbrev=0', {
    readOnly: true,
    allowFail: true,
  });
  const parsed = latestTag ? latestTag.replace(/^v/, "").match(lawossPattern) : null;
  if (!parsed) {
    fail(
      `No v<upstream>-lawoss.<n> tag reachable from HEAD${latestTag ? ` ('${latestTag}' does not match)` : ""}.\n` +
      "  Pass the first version of this upstream base explicitly: --set x.y.z-lawoss.1",
    );
  }
  version = `${parsed[1]}-lawoss.${Number(parsed[2]) + 1}`;
  success(`Latest LAWOSS release tag: ${latestTag} → next: ${version}`);
}

const tag = `v${version}`;

const localTag = run(`git rev-parse -q --verify refs/tags/${tag}`, {
  readOnly: true,
  allowFail: true,
});
if (localTag) fail(`Tag ${tag} already exists locally`);
const remoteTag = run(`git ls-remote --tags origin refs/tags/${tag}`, { readOnly: true });
if (remoteTag) fail(`Tag ${tag} already exists on origin`);
success(`Tag ${tag} is available`);

// ── Step 3: Release review ──────────────────────────────────────────
heading("Running release review");
const reviewOutput = run("node scripts/release/review.mjs --strict", { readOnly: true, allowFail: false });
log(reviewOutput);
success("Release review passed");

// ── Step 4: Tag ─────────────────────────────────────────────────────
heading("Creating tag");
run(`git tag ${tag}`);
success(`Tagged ${tag} at ${run("git rev-parse --short HEAD", { readOnly: true })}`);

// ── Summary ─────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(50));
console.log(`  Release prepared: ${tag}`);
console.log(`  Version:          ${version}`);
console.log(`  Source:           ${explicitVersion !== null ? "explicit (--set)" : "next n of latest v*-lawoss.* tag"}`);
console.log("  No commit needed — CI stamps the version from the tag.");
if (dryRun) {
  console.log("  Mode:             DRY RUN (nothing was changed)");
}
console.log("");
console.log("  Next step:");
console.log(`    pnpm release:ship`);
console.log("─".repeat(50) + "\n");
