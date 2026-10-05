// LAWOSS: test stráže značky. Spúšťa sa v CI cez check-no-eigenwelt.test.mjs
// (rovnaký krok v jobe legalwork-tests) alebo samostatne:
// node --test lawoss/scripts/check-branding.test.mjs
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_TEXT,
  BRANDING_DESKTOP_COPY,
  BRANDING_SOURCE,
  LOCALE_FILES,
  PINNED_IDENTITY,
  STRUCTURE,
  checkBranding,
  checkLocales,
  checkMirror,
  checkSources,
  checkStructure,
  parseDictionary,
  parseExemptKeys,
  visibleBrandLeak,
  writeMirror,
} from "./check-branding.mjs";
import { BRAND_NAME, FORK_RELEASES_URL, brandAppName } from "../branding.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporary = [];
after(() => temporary.forEach((path) => rmSync(path, { recursive: true, force: true })));

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "lawoss-brand-"));
  temporary.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** Kópia súborov, ktoré stráž číta, s jednou zmenou. */
function repoWith(file, change) {
  const root = mkdtempSync(join(tmpdir(), "lawoss-brand-repo-"));
  temporary.push(root);
  const files = new Set([
    ...STRUCTURE.map((rule) => rule.file),
    ...LOCALE_FILES.map((entry) => entry.file),
    "apps/app/src/i18n/index.ts",
    BRANDING_SOURCE,
    BRANDING_DESKTOP_COPY,
  ]);
  for (const path of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(repo, path), join(root, path));
  }
  const path = join(root, file);
  writeFileSync(path, change(readFileSync(path, "utf8")));
  return root;
}

const structureProblems = (file, change) => checkStructure(repoWith(file, change)).filter((line) => line.startsWith(file));

describe("LAWOSS stráž značky", () => {
  test("repozitár je v poriadku", () => {
    assert.deepEqual(checkBranding(repo), []);
  });

  test("značka je LAWOSS a vývojový režim sa odlišuje", () => {
    assert.equal(BRAND_NAME, "LAWOSS");
    assert.equal(brandAppName(false), "LAWOSS");
    assert.equal(brandAppName(true), "LAWOSS - Dev");
    assert.equal(FORK_RELEASES_URL, "https://github.com/Omni-Legal-Products/lawoss/releases");
  });

  test("desktopová kópia sa líši od zdroja: zlyhá, --write ju opraví", () => {
    const root = repoWith(BRANDING_DESKTOP_COPY, (text) => text.replace('"LAWOSS"', '"LegalWork"'));
    assert.equal(checkMirror(root).length, 1);
    writeMirror(root);
    assert.deepEqual(checkMirror(root), []);
  });

  test("zmena APP_IDENTIFIER, appId alebo priečinka s dátami zlyhá", () => {
    const main = "apps/desktop/electron/main.mjs";
    assert.ok(structureProblems(main, (text) => text.replace(`"${PINNED_IDENTITY.bundleIdentifier}"`, '"sk.lawoss.app"')).length > 0);
    assert.ok(structureProblems(main, (text) => text.replace(`"${PINNED_IDENTITY.devIdentifier}"`, '"sk.lawoss.app.dev"')).length > 0);
    assert.ok(structureProblems(main, (text) => text.replace('const DESKTOP_PROTOCOL_SCHEME = "legalwork";', 'const DESKTOP_PROTOCOL_SCHEME = "lawoss";')).length > 0);
    assert.ok(structureProblems(main, (text) => text.replace('path.join(app.getPath("appData"), APP_IDENTIFIER)', 'path.join(app.getPath("appData"), APP_NAME)')).length > 0);
    const builder = "apps/desktop/electron-builder.yml";
    assert.ok(structureProblems(builder, (text) => text.replace("appId: com.eigenweltlabs.legalwork", "appId: sk.lawoss.app")).length > 0);
  });

  test("návrat názvu LegalWork do appky zlyhá", () => {
    const main = "apps/desktop/electron/main.mjs";
    assert.ok(structureProblems(main, (text) => text.replace("const DISPLAY_NAME = brandAppName(isDevMode);", 'const DISPLAY_NAME = isDevMode ? "LegalWork - Dev" : "LegalWork";')).length > 0);
    assert.ok(structureProblems(main, (text) => text.replace(/brandAppName\(isDevMode\);\nconst DISPLAY_NAME/, '(isDevMode ? "LegalWork - Dev" : "LegalWork");\nconst DISPLAY_NAME')).length > 0);
    assert.ok(structureProblems("apps/desktop/electron-builder.yml", (text) => text.replace("productName: LAWOSS", "productName: LegalWork")).length > 0);
    assert.ok(structureProblems("apps/app/index.html", (text) => text.replace("<title>LAWOSS</title>", "<title>LegalWork</title>")).length > 0);
    assert.ok(structureProblems("apps/app/src/react-app/shell/shell-config.tsx", (text) => text.replace('appName: "LAWOSS",', 'appName: "LegalWork",')).length > 0);
    assert.ok(structureProblems("apps/app/src/i18n/index.ts", (text) => text.replace("const branded = BRAND_EXEMPT_KEYS.has(key) ? result : applyBrandName(result);", "const branded = result;")).length > 0);
  });

  test("text povolenia macOS s menom upstreamu zlyhá, licencia a binárky nie", () => {
    const builder = "apps/desktop/electron-builder.yml";
    const problems = structureProblems(builder, (text) => text.replace("NSMicrophoneUsageDescription: LAWOSS uses", "NSMicrophoneUsageDescription: LegalWork uses"));
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /NSMicrophoneUsageDescription/);
  });

  test("slovník: text, ktorý t() nezmení na LAWOSS, zlyhá", () => {
    assert.equal(visibleBrandLeak("Open LegalWork settings", false), null);
    assert.equal(visibleBrandLeak("Open LegalWork settings", true), "LegalWork");
    assert.equal(visibleBrandLeak("Restart the Legalwork server", false), "Legalwork");
    assert.equal(visibleBrandLeak("Set LEGALWORK_DEV_MODE=1 or open legalwork://open", false), null);
    assert.equal(visibleBrandLeak("Call legalwork_project_get_details first.", false), null);

    const sk = "apps/app/src/i18n/locales/sk.ts";
    const variant = repoWith(sk, (text) => text.replace('"office_addins.tab_label": "Doplnky Office",', '"office_addins.tab_label": "Doplnky Office pre Legalwork",'));
    assert.deepEqual(checkLocales(variant).map((line) => line.split(":")[0]), [sk]);
  });

  test("nový kľúč v BRAND_EXEMPT_KEYS bez dôvodu v stráži zlyhá", () => {
    const index = "apps/app/src/i18n/index.ts";
    const root = repoWith(index, (text) => text.replace('"mcp.quick_connect_legalmemory_desc",', '"mcp.quick_connect_legalmemory_desc",\n  "office_addins.tab_description",'));
    const problems = checkLocales(root);
    assert.ok(problems.some((line) => line.startsWith(index) && line.includes("office_addins.tab_description")), problems.join("\n"));
    assert.ok(problems.some((line) => line.includes("locales/en.ts") && line.includes("office_addins.tab_description")), problems.join("\n"));
    assert.ok(parseExemptKeys(readFileSync(join(repo, index), "utf8")).size >= 1);
    for (const key of parseExemptKeys(readFileSync(join(repo, index), "utf8"))) assert.ok(Object.hasOwn(ALLOWED_TEXT, key));
  });

  test("slovník LAWOSS s menom upstreamu zlyhá aj tam, kde by ho t() nahradilo", () => {
    const file = "apps/app/src/lawoss/i18n/new.ts";
    const root = repoWith(BRANDING_SOURCE, (text) => text);
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), 'export const newSk = {\n  "lawoss.new.title":\n    "LegalWork pripraví spis",\n};\n');
    assert.equal(parseDictionary(readFileSync(join(root, file), "utf8")).length, 1);
    assert.deepEqual(checkLocales(root, []), []);
    const problems = checkLocales(root, [file]);
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], /lawoss\.new\.title/);
  });

  test("UI LAWOSS a odkazy na releasy upstreamu", () => {
    const files = {
      "apps/app/src/lawoss/okf/new-view.tsx": 'export const View = () => <p>Server LegalWork nebeží</p>;\n// Komentár o LegalWorku nevadí.\n',
      "apps/app/src/lawoss/okf/new-view.test.tsx": 'expect("LegalWork").toBe("LegalWork");\n',
      "apps/app/src/lawoss/okf/types.ts": "import type { LegalworkServerClient } from \"@/app/lib/legalwork-server\";\n",
      "apps/app/src/app/lib/new-updater.ts": 'const url = "https://github.com/eigenweltlabs/legalwork/releases/latest";\n',
      "apps/desktop/electron/new-link.mjs": 'const site = "https://legalwork.app";\n// https://github.com/eigenweltlabs/legalwork v komentári nevadí\n',
      "apps/app/src/i18n/locales/xx.ts": '"debug.path": "LegalWork.app.migrate-bak",\n',
    };
    const problems = checkSources(fixture(files), Object.keys(files));
    assert.equal(problems.length, 3, problems.join("\n"));
    assert.ok(problems.some((line) => line.startsWith("apps/app/src/lawoss/okf/new-view.tsx") && line.includes("LegalWork")));
    assert.ok(problems.some((line) => line.startsWith("apps/app/src/app/lib/new-updater.ts")));
    assert.ok(problems.some((line) => line.startsWith("apps/desktop/electron/new-link.mjs") && line.includes("legalwork.app")));
  });
});
