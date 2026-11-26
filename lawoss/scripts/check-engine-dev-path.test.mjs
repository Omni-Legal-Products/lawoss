// Internal builds use the development engine. The signed Mac alpha uses the approved LAWOSS publisher.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowsDir = path.join(root, ".github", "workflows");
const UPSTREAM_ONLY = "github.repository == 'eigenweltlabs/legalwork'";
const MAC_ALPHA = "alpha-macos-aarch64.yml";
const signed = "needs.signing.outputs.signed == 'true'";
const engineMode = "${{ " + signed + " && 'production' || 'development' }}";
const desktopMode = "${{ " + signed + " && 'build:electron:production' || 'build:electron' }}";
const PRODUCER = "ci-opencode-derivative.yml";
const PRODUCTION_PATTERNS = [
  /\bbuild-mode:\s*['"]?production\b/,
  /\bengine-build-mode:\s*['"]?production\b/,
  /\bbuild-mode:\s*\$\{\{[^}]*'production'/,
  /build:electron:production/,
  /engine:prepare:production/,
  /--engine-mode\s+production/,
  /--mac-signing-config/,
];

const workflows = readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(path.join(workflowsDir, name), "utf8") }));

/** Top-level jobs as text blocks with their own `if:` condition (first one at job indentation). */
function jobs(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (start < 0) return [];
  const result = [];
  let current;
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) { current = { id: header[1], lines: [] }; result.push(current); continue; }
    if (/^\S/.test(line)) break;
    current?.lines.push(line);
  }
  return result.map((job) => ({
    id: job.id,
    body: job.lines.join("\n"),
    condition: job.lines.find((line) => /^ {4}if:/.test(line)) ?? "",
  }));
}

test("only the signed Mac alpha selects production in LAWOSS callers", () => {
  const offenders = [];
  for (const { name, text } of workflows) {
    if (name === PRODUCER) continue;
    for (const job of jobs(text)) {
      if (job.condition.includes(UPSTREAM_ONLY)) continue;
      let body = job.body;
      if (name === MAC_ALPHA && ["opencode-engine", "publish-alpha-macos-aarch64"].includes(job.id)) {
        const allowed = [`build-mode: ${engineMode}`];
        if (job.id === "publish-alpha-macos-aarch64") allowed.push(`DESKTOP_BUILD_SCRIPT: ${desktopMode}`);
        body = body.split("\n").filter(line => !allowed.includes(line.trim())).join("\n");
      }
      for (const pattern of PRODUCTION_PATTERNS) {
        if (pattern.test(body)) offenders.push(`${name}#${job.id}: ${pattern}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("the producer admits only a manual LAWOSS dev build of the dispatched revision for production", () => {
  const producer = workflows.find(({ name }) => name === PRODUCER);
  const build = jobs(producer.text).find(job => job.id === "build");
  const guard = /node --input-type=module <<'NODE'\n([\s\S]*?)\n\s*NODE\n/.exec(build.body);
  assert.ok(guard, "missing producer admission check");
  const sha = "a".repeat(40);
  const env = { BUILD_MODE: "production", BUILD_REPOSITORY: "Omni-Legal-Products/lawoss",
    BUILD_REF: "refs/heads/dev", BUILD_EVENT: "workflow_dispatch", CHECKOUT_SHA: sha, GITHUB_SHA: sha };
  const run = overrides => spawnSync(process.execPath, ["--input-type=module", "-e", guard[1]], { env: { ...env, ...overrides } }).status;
  assert.equal(run({}), 0);
  for (const overrides of [
    { BUILD_REPOSITORY: "eigenweltlabs/legalwork" }, { BUILD_REF: "refs/heads/candidate" },
    { BUILD_EVENT: "pull_request" }, { CHECKOUT_SHA: "b".repeat(40) },
    { REUSE_RUN_ID: "123" }, { REUSE_MANIFEST_SHA256: "c".repeat(64) },
  ]) assert.equal(run(overrides), 1, JSON.stringify(overrides));
});

test("engine callers restrict signing credentials to the signed Mac alpha", () => {
  for (const { name, text } of workflows) {
    for (const job of jobs(text)) {
      if (!job.body.includes(`uses: ./.github/workflows/${PRODUCER}`) || job.condition.includes(UPSTREAM_ONLY)) continue;
      if (name === MAC_ALPHA && job.id === "opencode-engine") {
        const lines = job.body.split("\n").map(line => line.trim());
        assert.ok(lines.includes(`build-mode: ${engineMode}`));
        for (const key of ["APPLE_CODESIGN_CERT_P12_BASE64", "APPLE_CODESIGN_CERT_PASSWORD"]) {
          assert.deepEqual(lines.filter(line => line.startsWith(key + ":")), [
            key + ": ${{ " + signed + " && secrets." + key + " || '' }}",
          ]);
        }
        assert.doesNotMatch(job.body, /secrets:\s*inherit/);
        continue;
      }
      assert.match(job.body, /\n\s+build-mode: development\s*(\n|$)/, `${name}#${job.id} must request build-mode: development`);
      assert.doesNotMatch(job.body, /APPLE_CODESIGN_CERT|secrets:\s*inherit/, `${name}#${job.id} must not pass signing secrets to the engine build`);
    }
  }
});

test("alpha workflows stay manual and keep the unsigned internal gate", () => {
  for (const name of ["alpha-macos-aarch64.yml", "alpha-windows-x64.yml"]) {
    const { text } = workflows.find((workflow) => workflow.name === name) ?? {};
    assert.ok(text, `${name} is missing`);
    assert.match(text, /allow_unsigned_internal/);
    const trigger = /^on:\n([\s\S]*?)^\S/m.exec(text)?.[1] ?? "";
    assert.match(trigger, /workflow_dispatch:/);
    assert.doesNotMatch(trigger, /^\s{2}(push|workflow_run|schedule):/m, `${name} must not build alphas automatically`);
  }
});

test("development preparation never consults the production Mac signer", async () => {
  const { sourceBuildIdentity } = await import("../../packages/opencode-release/build/prepare.mjs");
  const identity = await sourceBuildIdentity({ mode: "development" });
  assert.equal(identity.signer, "development-ad-hoc");
  assert.equal(identity.targets.length, 1, "development prepares only the host target, not the twelve-target matrix");
  // The top-level preparer adds the production signer only for production mode.
  const prepare = readFileSync(path.join(root, "packages", "opencode-release", "prepare.mjs"), "utf8");
  for (const line of prepare.split("\n").filter((entry) => entry.includes("productionMacSigner"))) {
    assert.match(line, /mode === "production"/, `productionMacSigner must stay behind production mode: ${line.trim()}`);
  }
});
