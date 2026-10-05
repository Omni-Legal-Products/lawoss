// LAWOSS: test stráže proti Eigenweltu a analytike. Spúšťa sa v CI:
// node --test lawoss/scripts/check-no-eigenwelt.test.mjs
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { STRUCTURE, checkBuild, checkCatalog, checkRepo, checkSources, checkStructure } from "./check-no-eigenwelt.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporary = [];
after(() => temporary.forEach((path) => rmSync(path, { recursive: true, force: true })));

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "lawoss-guard-"));
  temporary.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** Kópia súborov, ktoré stráži STRUCTURE, s jednou zmenou. */
function structureWith(file, change) {
  const root = mkdtempSync(join(tmpdir(), "lawoss-guard-structure-"));
  temporary.push(root);
  for (const rule of STRUCTURE) {
    mkdirSync(dirname(join(root, rule.file)), { recursive: true });
    cpSync(join(repo, rule.file), join(root, rule.file));
  }
  const path = join(root, file);
  writeFileSync(path, change(readFileSync(path, "utf8")));
  return root;
}

describe("LAWOSS stráž Eigenweltu a analytiky", () => {
  test("repozitár je v poriadku", () => {
    assert.deepEqual(checkRepo(repo), []);
  });

  test("nová adresa Eigenweltu, kľúč PostHog alebo telemetria v kóde zlyhá", () => {
    const files = {
      "apps/server/src/new-sync.ts": 'await fetch("https://platform.eigenweltlabs.com/api/x");',
      "apps/app/src/new-analytics.ts": 'const key = "phc_abcdefghijklmnopqrstuvwxyz123";',
      "apps/desktop/electron/crash.mjs": 'import * as Sentry from "@sentry/electron";',
      "apps/server/src/systemone.ts": 'const url = "https://models.eigenweltlabs.com";',
      "apps/server/src/systemone.test.ts": 'const url = "https://platform.eigenweltlabs.com";',
    };
    const problems = checkSources(fixture(files), Object.keys(files));
    assert.equal(problems.length, 4, problems.join("\n"));
    assert.ok(problems.some((line) => line.startsWith("apps/server/src/systemone.ts") && line.includes("models.eigenweltlabs.com")));
    assert.ok(!problems.some((line) => line.includes("systemone.test.ts")));
  });

  test("prepínač analytiky v UI bez isAnalyticsChoiceHidden zlyhá", () => {
    const files = { "apps/app/src/react-app/new-privacy.tsx": '<Switch aria-label={t("settings.analytics_toggle")} />' };
    assert.equal(checkSources(fixture(files), Object.keys(files)).length, 1);
  });

  test("návrat sťahovania katalógu zlyhá", () => {
    const managed = structureWith("apps/server/src/managed-opencode.ts", (text) => text.replace("    ...lawossEnv,\n    OPENCODE_SERVER_USERNAME: username,", "    OPENCODE_SERVER_USERNAME: username,"));
    assert.ok(checkStructure(managed).some((line) => line.startsWith("apps/server/src/managed-opencode.ts")));
    const embedded = structureWith("apps/server/src/embedded.ts", (text) => text.replace("          ...(managedDb ? { OPENCODE_DB", '          OPENCODE_MODELS_URL: "https://models.example.test",\n          ...(managedDb ? { OPENCODE_DB'));
    assert.ok(checkStructure(embedded).some((line) => line.startsWith("apps/server/src/embedded.ts")));
    const env = structureWith("apps/server/src/lawoss/engine-network.ts", (text) => text.replace('OPENCODE_DISABLE_MODELS_FETCH: "1"', 'OPENCODE_DISABLE_MODELS_FETCH: "0"'));
    assert.ok(checkStructure(env).length > 0);
  });

  test("analytika, ktorá sa dá zapnúť alebo odoslať, zlyhá", () => {
    const sending = structureWith("apps/app/src/app/lib/analytics.ts", (text) => `${text}\nvoid fetch("https://example.test/batch/");\n`);
    assert.ok(checkStructure(sending).some((line) => line.includes("analytics.ts")));
    const enabled = structureWith("apps/app/src/app/lib/analytics.ts", (text) => text.replace("export function isAnalyticsEnabled(): boolean {\n  return false;", "export function isAnalyticsEnabled(): boolean {\n  return true;"));
    assert.ok(checkStructure(enabled).some((line) => line.includes("analytics.ts")));
    const toggle = structureWith("apps/app/src/lawoss/feature-flags.ts", (text) => text.replace("isAnalyticsChoiceHidden = (): boolean => true", "isAnalyticsChoiceHidden = (): boolean => false"));
    assert.ok(checkStructure(toggle).some((line) => line.includes("feature-flags.ts")));
  });

  test("odkrytý účet Eigenwelt alebo jeho poistka na serveri zlyhá", () => {
    const surface = structureWith("apps/app/src/lawoss/feature-flags.ts", (text) => text.replace('  "eigenwelt-trial",\n]);', "]);"));
    assert.ok(checkStructure(surface).some((line) => line.includes("feature-flags.ts")));
    const server = structureWith("apps/server/src/lawoss/commercial-services.ts", (text) => text.replace('env[EIGENWELT_ACCOUNT_ENV] === "1";', 'env[EIGENWELT_ACCOUNT_ENV] !== "0";'));
    assert.ok(checkStructure(server).some((line) => line.includes("commercial-services.ts")));
  });

  test("katalóg bez odporúčaného modelu ChatGPT zlyhá", () => {
    const providers = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`p${index}`, { models: { m: {} } }]));
    const root = fixture({ "api.json": JSON.stringify({ ...providers, openai: { models: { "gpt-5.6-luna": {} } } }) });
    assert.deepEqual(checkCatalog(join(root, "api.json")).length, 1);
  });

  test("buildnutý výstup s kľúčom analytiky zlyhá", () => {
    const root = fixture({
      "apps/app/dist/assets/index.js": 'fetch("https://eu.i.posthog.com/batch/",{body:JSON.stringify({api_key:"phc_abcdefghijklmnopqrstuvwxyz123"})})',
      "apps/server/dist/ok.js": "export const ok = 1;",
    });
    assert.equal(checkBuild(root).length, 2);
  });
});
