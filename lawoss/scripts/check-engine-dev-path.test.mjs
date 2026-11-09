// LAWOSS (ADR 0016, rozhodnutie MČ 8. 11. 2026): engine 2.1.4-legalwork.http-policy.4 sa pre LAWOSS
// pripravuje len vývojovou cestou s ad-hoc podpisom. Ostrá príprava (matica 12 cieľov, Mac podpis
// identitou Eigenwelt z packages/opencode-release/selection.json) sa vo workflowoch forku nespúšťa.
// Nepodpísané alfy ostávajú ručné so vstupom `allow_unsigned_internal`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowsDir = path.join(root, ".github", "workflows");
const UPSTREAM_ONLY = "github.repository == 'eigenweltlabs/legalwork'";
// Reusable producer with its own repository assertion; it never runs production from the fork.
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

test("no LAWOSS workflow job selects the production engine path or the Eigenwelt signer", () => {
  const offenders = [];
  for (const { name, text } of workflows) {
    if (name === PRODUCER) continue;
    for (const job of jobs(text)) {
      if (job.condition.includes(UPSTREAM_ONLY)) continue;
      for (const pattern of PRODUCTION_PATTERNS) {
        if (pattern.test(job.body)) offenders.push(`${name}#${job.id}: ${pattern}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("the shared engine producer refuses production outside the upstream repository", () => {
  const producer = workflows.find(({ name }) => name === PRODUCER);
  assert.ok(producer, `${PRODUCER} is missing`);
  assert.match(producer.text,
    /if \(process\.env\.BUILD_MODE === 'production'\) \{\s*\n\s*assert\.equal\(process\.env\.BUILD_REPOSITORY, 'eigenweltlabs\/legalwork'\);/);
  // Every caller asks for the development path explicitly.
  for (const { name, text } of workflows) {
    for (const job of jobs(text)) {
      if (!job.body.includes(`uses: ./.github/workflows/${PRODUCER}`) || job.condition.includes(UPSTREAM_ONLY)) continue;
      assert.match(job.body, /\n\s+build-mode: development\s*(\n|$)/, `${name}#${job.id} must request build-mode: development`);
      assert.doesNotMatch(job.body, /APPLE_CODESIGN_CERT/, `${name}#${job.id} must not pass signing secrets to the engine build`);
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
