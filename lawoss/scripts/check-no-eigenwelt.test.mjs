// LAWOSS: test stráže proti Eigenweltu a analytike. Spúšťa sa v CI:
// node --test lawoss/scripts/check-no-eigenwelt.test.mjs
// Import nižšie pridá aj testy stráže značky do toho istého behu.
import "./check-branding.test.mjs";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { MARKETPLACE_CHECK_FILE, STRUCTURE, checkBuild, checkCatalog, checkMarketplaceNetwork, checkRepo, checkSources, checkStructure } from "./check-no-eigenwelt.mjs";

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

  /** Zmena musí niečo zmeniť a stráž ju musí nahlásiť pri tom istom súbore. */
  function assertCaught(file, change) {
    const original = readFileSync(join(repo, file), "utf8");
    assert.notEqual(change(original), original, `${file}: zmena v teste už nesedí na súbor`);
    assert.ok(checkStructure(structureWith(file, change)).some((line) => line.startsWith(file)), `${file}: stráž zmenu nenahlásila`);
  }

  test("sťahovanie modelov bez zapnutia OCR zlyhá (štart, route, prvé použitie)", () => {
    assertCaught("apps/server/src/config.ts", (text) => text.replace("fileConfig.autoDownloadOcr ?? false,", "fileConfig.autoDownloadOcr ?? true,"));
    assertCaught("apps/server/src/server.ts", (text) => text.replace("if (config.autoDownloadOcr && !config.readOnly) void ocr.downloadDefaultIfNeeded();", "void ocr.downloadDefaultIfNeeded();"));
    assertCaught("apps/server/src/server.ts", (text) => `${text}\nvoid prepareLayoutModel(dir, signal);\n`);
    assertCaught("apps/server/src/server.ts", (text) => text.replace("const ocr = new LawossOcrManager(", "const ocr = new OcrManager("));
    assertCaught("apps/server/src/lawoss/ocr-opt-in.ts", (text) => text.replace('Reflect.get(value, "enabled") === true', 'Reflect.get(value, "enabled") !== false'));
    assertCaught("apps/server/src/lawoss/ocr-opt-in.ts", (text) => text.replace("    await requireOcrEnabled(this.runtime.root);\n    return super.install(id, automatic);", "    return super.install(id, automatic);"));
    assertCaught("apps/server/src/lawoss/ocr-opt-in.ts", (text) => text.replace("return ocrEnabledNow(this.runtime.root) ? super.downloadDefaultIfNeeded() : Promise.resolve();", "return super.downloadDefaultIfNeeded();"));
    assertCaught("apps/server/src/lawoss/ocr-opt-in.ts", (text) => text.replace("export async function downloadLocalOcrModel(ocr: OcrManager) {\n  await requireOcrEnabled(ocr.runtime.root);", "export async function downloadLocalOcrModel(ocr: OcrManager) {"));
    assertCaught("apps/server/src/lawoss/ocr-on-demand.ts", (text) => text.replace("  await requireOcrEnabled(ocr.runtime.root);\n  if (engine.model", "  if (engine.model"));
    assertCaught("apps/server/src/document-preparation/service.ts", (text) => text.replace("  if (!await ocrEnabled(ocr.runtime.root)) return textLayerSnapshot();\n", ""));
    assertCaught("apps/server/src/document-preparation/service.ts", (text) => text.replace("} else if (selected.textOnly) {", "} else if (false) {"));
    assertCaught("apps/server/src/document-preparation/service.ts", (text) => text.replace("await selected.download?.wait(job.controller.signal);", ""));
  });

  test("appka bez zapnutia nesťahuje model OCR ani modely rečníkov", () => {
    assertCaught("apps/app/src/react-app/shell/settings-route.tsx", (text) => text.replace("ocrView={<LawossOcrSettings ", "ocrView={<OcrSettingsSection "));
    assertCaught("apps/app/src/lawoss/domains/settings/ocr-opt-in-section.tsx", (text) => text.replace("{view?.enabled && client ? <OcrSettingsSection ", "{client ? <OcrSettingsSection "));
    assertCaught("apps/app/src/react-app/domains/recorder/recorder-store.ts", (text) => text.replace("      void get().prewarm();\n", "      void get().prewarm();\n      void get().ensureDiarizationReady();\n"));
    assertCaught("apps/app/src/react-app/domains/recorder/recorder-store.ts", (text) => text.replace("      void get().prewarm();\n", "      void get().prewarm();\n      void get().downloadDiarization();\n"));
    const files = {
      "apps/desktop/electron/server-env.mjs": 'const env = { LEGALWORK_OCR_AUTO_DOWNLOAD: "1" };',
      "apps/server/src/embedded-config.ts": "config.autoDownloadOcr = true;",
      "apps/server/src/ocr/auto-download.test.ts": 'process.env.LEGALWORK_OCR_AUTO_DOWNLOAD = "1";',
      "apps/server/src/lawoss/prefetch.ts": "await ocr.runtime.install(engine);",
      "apps/server/src/reviews/warmup.ts": "await prepareSmallModel(directory, signal);",
      "apps/app/src/react-app/domains/reviews/auto-ocr.tsx": "useEffect(() => { void client.installOcrEngine(\"local-fast\"); }, []);",
      "apps/app/src/lawoss/lite/today.tsx": "void client.downloadLawossOcrModel();",
      "apps/app/src/react-app/shell/session-route.tsx": "void useRecorderStore.getState().ensureDiarizationReady();",
      "apps/app/src/react-app/domains/recorder/recorder-pane.tsx": "void store.downloadDiarization();",
      "apps/server/src/ocr/manager.ts": "await this.runtime.install(engine);",
      "apps/app/src/react-app/domains/settings/pages/ocr-settings-section.tsx": "client.installOcrEngine(engine.id)",
    };
    const problems = checkSources(fixture(files), Object.keys(files));
    assert.equal(problems.length, 8, problems.join("\n"));
    for (const allowed of ["manager.ts", "ocr-settings-section.tsx", "auto-download.test.ts"]) assert.ok(!problems.some((line) => line.includes(allowed)), allowed);
  });

  test("katalóg bez odporúčaného modelu ChatGPT zlyhá", () => {
    const providers = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`p${index}`, { models: { m: {} } }]));
    const root = fixture({ "api.json": JSON.stringify({ ...providers, openai: { models: { "gpt-5.6-luna": {} } } }) });
    assert.deepEqual(checkCatalog(join(root, "api.json")).length, 1);
  });

  test("zdroje integrácií: LegalMemory nikdy, LegalWork predvolene vypnutý, LegalQuants bez zdroja neskenuje", () => {
    const fails = (file, change) => checkStructure(structureWith(file, change)).some((line) => line.startsWith(file));
    const flags = "apps/app/src/lawoss/feature-flags.ts";
    // LegalMemory vypadne zo skrytých alebo ho prepínač zdroja odkryje.
    assert.ok(fails(flags, (text) => text.replace('  "legalmemory",\n]);', "]);")));
    assert.ok(fails(flags, (text) => text.replace("HIDDEN_QUICK_CONNECT_SERVERS.has(serverName) ||\n  (", "(")));
    assert.ok(fails(flags, (text) => text.replace("new Set<string>([]);", 'new Set<string>(["legalmemory"]);')));
    assert.ok(fails(flags, (text) => text.replace("isLegalQuantsHidden = (): boolean => !isLegalworkSourceEnabled();", "isLegalQuantsHidden = (): boolean => false;")));
    // Zdroj LegalWork predvolene zapnutý alebo voľba so sieťou.
    const source = "apps/app/src/lawoss/domains/integrations/legalwork-source.ts";
    assert.ok(fails(source, (text) => text.replace("} catch {\n    return false;\n  }\n}\n\nlet enabled", "} catch {\n    return true;\n  }\n}\n\nlet enabled")));
    assert.ok(fails(source, (text) => text.replace("let enabled = read();", "let enabled = true;")));
    assert.ok(fails(source, (text) => `${text}\nvoid fetch("https://example.test");\n`));
    assert.ok(fails("apps/app/src/lawoss/domains/integrations/legalwork-source-sync.ts", (text) => `${text}\nvoid connectMcp;\n`));
    // LegalQuants sa vykreslí (a skenuje GitHub) aj bez zdroja.
    assert.ok(fails("apps/app/src/react-app/domains/settings/pages/legalquants-import.tsx", (text) => text.replace("  if (!useLegalworkSource()) return null;\n", "")));
    assert.ok(fails("apps/app/src/react-app/domains/settings/pages/workflows-view.tsx", (text) => text.replace("{isLegalQuantsHidden() ? null : <DropdownMenuItem", "{<DropdownMenuItem")));
    // Upstream sync zmrazí katalóg alebo obíde filter.
    // Zoznam pluginov alebo balíkov späť v kóde appky.
    assert.ok(fails("apps/app/src/lawoss/domains/marketplace/base-pack.ts", (text) => `${text}\nexport const SK = ["slovlex", "orsr"];\n`));
    assert.ok(fails("apps/app/src/lawoss/domains/marketplace/catalog.ts", (text) => text.replace('import snapshotJson from "./marketplace-snapshot.json";', 'const snapshotJson = { plugins: [{ name: "orsr" }] };')));
    assert.ok(fails("apps/app/src/app/constants.ts", (text) => text.replace("(entry) => !isHiddenQuickConnect(entry.serverName ?? \"\"),", "() => true,")));
  });

  test("LAWOSS Marketplace: týždenná kontrola len na lawoss-marketplace, presne 7 dní, nie pri štarte, nič neinštaluje", () => {
    const fails = (file, change) => checkStructure(structureWith(file, change)).some((line) => line.startsWith(file));
    const check = MARKETPLACE_CHECK_FILE;
    // Iný repozitár, iná adresa alebo iný interval.
    assert.ok(fails(check, (text) => text.replace('MARKETPLACE_REPO = "lawoss-marketplace"', 'MARKETPLACE_REPO = "iny-repozitar"')));
    assert.ok(fails(check, (text) => text.replace('"https://api.github.com"', '"https://api.example.com"')));
    assert.ok(fails(check, (text) => text.replace("7 * 24 * 60 * 60 * 1000", "24 * 60 * 60 * 1000")));
    // Kontrola hneď pri štarte (bez začiatku týždňa), bez vypínača alebo bez oneskorenia.
    assert.ok(fails(check, (text) => text.replace('return "anchored";', 'return "checked";')));
    assert.ok(fails(check, (text) => text.replace("if (!state.weeklyCheck) return false;", "")));
    assert.ok(fails(check, (text) => text.replace("const first = setTimeout(() => {\n    tick();", "tick();\n  const first = setTimeout(() => {")));
    assert.ok(fails(check, (text) => text.replace(' || process.env.LAWOSS_MARKETPLACE_WEEKLY_CHECK === "0"', "")));
    // Kontrola sama inštaluje.
    assert.ok(fails(check, (text) => `${text}\nimport { updateGlobalPlugin } from "./marketplace-global.js";\n`));
    // Inštalácia pre všetkých klientov z iného repozitára, upozornenie so sieťou, onboarding so sieťou pri otvorení.
    assert.ok(fails("apps/server/src/lawoss/marketplace-global.ts", (text) => text.replace("/tree/[a-f0-9]{40}/", "/tree/[^/]+/")));
    assert.ok(fails("apps/app/src/lawoss/domains/marketplace/update-notifier.tsx", (text) => text.replace("const view = await api.view()", 'await api.check("manual");\n      const view = await api.view()')));
    assert.ok(fails("apps/app/src/lawoss/domains/onboarding/packs-step.tsx", (text) => text.replace("useLawossMarketplace({ api })", "useLawossMarketplace({ api, checkOnOpen: true })")));
    assert.ok(fails("apps/server/src/server.ts", (text) => text.replace("const stopMarketplaceCheck = startWeeklyMarketplaceCheck(config);", "const stopMarketplaceCheck = () => undefined;")));

    // Nová adresa, druhý časovač alebo priamy fetch v module kontroly.
    const source = readFileSync(join(repo, check), "utf8");
    assert.deepEqual(checkMarketplaceNetwork(fixture({ [check]: source })), []);
    assert.equal(checkMarketplaceNetwork(fixture({ [check]: `${source}\nconst x = "https://telemetry.example.com/ping";\n` })).length, 1);
    assert.equal(checkMarketplaceNetwork(fixture({ [check]: `${source}\nsetInterval(() => undefined, 1000);\n` })).length, 1);
    assert.equal(checkMarketplaceNetwork(fixture({ [check]: `${source}\nvoid fetch("https://api.github.com");\n` })).length, 1);

    // GitHub alebo plánovaná sieť inde v kóde LAWOSS.
    const files = {
      "apps/app/src/lawoss/domains/x/poll.ts": 'setInterval(() => fetch("https://api.github.com/repos/a/b"), 1000);',
      "apps/server/src/lawoss/other.ts": "setTimeout(() => void fetch(url), 10);",
      "apps/server/src/lawoss/fine.ts": "setTimeout(() => undefined, 10);",
    };
    const problems = checkSources(fixture(files), Object.keys(files));
    assert.equal(problems.length, 3, problems.join("\n"));
    assert.ok(!problems.some((line) => line.startsWith("apps/server/src/lawoss/fine.ts")));
  });

  test("buildnutý výstup s kľúčom analytiky zlyhá", () => {
    const root = fixture({
      "apps/app/dist/assets/index.js": 'fetch("https://eu.i.posthog.com/batch/",{body:JSON.stringify({api_key:"phc_abcdefghijklmnopqrstuvwxyz123"})})',
      "apps/server/dist/ok.js": "export const ok = 1;",
    });
    assert.equal(checkBuild(root).length, 2);
  });
});
