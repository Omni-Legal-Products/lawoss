#!/usr/bin/env node
/**
 * LAWOSS: stráž proti aktívnemu spojeniu s Eigenweltom a analytike.
 *
 * Rozhodnutie MČ 5. 10. 2026: Eigenwelt nesmie byť akýmkoľvek spôsobom aktívne
 * pripojený na appku a analytika je vypnutá natrvalo. Skript beží v CI jobe
 * `legalwork-tests` (`.github/workflows/ci-tests.yml`) na každom PR a zlyhá, keď:
 *
 * 1. sa v kóde alebo konfigurácii objaví adresa Eigenweltu, PostHog, kľúč `phc_…`
 *    alebo iná známa telemetria mimo povoleného zoznamu `ALLOWED` nižšie
 *    (súbor → presné reťazce → dôvod, prečo je tam mŕtvy, vypnutý alebo len odkaz);
 * 2. sa vráti sťahovanie katalógu modelov (poistky v `managed-opencode.ts`,
 *    `engine-network.ts`, `embedded.ts`, pribalený katalóg a jeho balenie);
 * 3. sa dá analytika zapnúť alebo odoslať (`analytics.ts`, prepínače v UI);
 * 4. zmizne serverová poistka účtu Eigenwelt alebo skrytie jeho plôch v appke;
 * 5. buildnutý výstup (`apps/server/dist`, `apps/app/dist`, `apps/desktop/server`),
 *    ak existuje, obsahuje kľúč alebo adresu analytiky či katalógu Eigenweltu.
 *
 * Použitie: `node lawoss/scripts/check-no-eigenwelt.mjs` (bez závislostí, Node 18+).
 * Postup pri upstream synci: `docs/upstream-sync-checklist.md`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOG_PATH, validateCatalog } from "./update-models-catalog.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Čo sa hľadá v zdrojoch. Zhoda sa porovnáva malými písmenami. */
export const FORBIDDEN = /[a-z0-9.-]*eigenweltlabs\.com|[a-z0-9.-]*posthog\.com|posthog|phc_[a-z0-9]{20,}|sentry\.io|@sentry\/|segment\.(?:io|com)|mixpanel|amplitude\.com|bugsnag|datadoghq/gi;

/** Čo sa hľadá v buildnutom výstupe: len aktívne ciele, nie odkazy. */
export const FORBIDDEN_IN_BUILD = /phc_[a-z0-9]{20,}|i\.posthog\.com|models\.eigenweltlabs\.com/gi;

const SCANNED_ROOTS = ["apps", "packages", "lawoss", "scripts", ".github", "constants.json", "package.json"];
const SKIPPED_FILE = /\.(?:md|txt|png|jpe?g|gif|ico|icns|woff2?|ttf|otf|mp4|webm|webp|svg|pdf|docx|xlsx|pptx|zip|gz|wasm|onnx|node|lock)$/i;
const SKIPPED_PATH = /(?:\.test\.|\.spec\.|\/tests?\/|\/__tests__\/|\/fixtures?\/|\.e2e\.|\/node_modules\/|^lawoss\/models-catalog\/)/;

/**
 * Povolené výskyty: súbor → reťazce, ktoré v ňom smú byť, a dôvod. Nový súbor alebo
 * nový reťazec v známom súbore treba posúdiť a dopísať sem s dôvodom.
 */
export const ALLOWED = {
  ".github/workflows/download-stats.yml": {
    matches: ["posthog"],
    reason: "Job beží len v eigenweltlabs/legalwork (podmienka if: github.repository).",
  },
  ".github/workflows/release-macos-aarch64.yml": {
    matches: ["eigenweltlabs.com"],
    reason: "Upstream release workflow, vo forku sa nespúšťa (vydáva sa cez alpha workflowy forku). Odkaz v poznámkach k vydaniu, nie spojenie appky.",
  },
  "scripts/release/report-download-stats.mjs": {
    matches: ["posthog", "eu.i.posthog.com", "phc_mvbq5pbmknzpmln6c6bmzb9yxqetf6bvspzba5vwrjfw"],
    reason: "Spúšťa ho len download-stats.yml, ktorý vo forku nebeží.",
  },
  "apps/app/src/app/constants.ts": {
    matches: ["eigenweltlabs.com"],
    reason: "Odkaz „Viac o LegalMemory“; rýchle pripojenie LegalMemory je skryté (HIDDEN_QUICK_CONNECT_SERVERS).",
  },
  "apps/app/src/app/lib/eigenwelt-budget.ts": {
    matches: ["platform.eigenweltlabs.com"],
    reason: "Odkaz na fakturáciu pri vyčerpanom pláne Eigenwelt; poskytovateľ eigenwelt je vypnutý v engine.",
  },
  "apps/app/src/app/lib/legalwork-server.ts": {
    matches: ["platform.eigenweltlabs.com"],
    reason: "Komentár k typu odpovede servera.",
  },
  "apps/app/src/i18n/locales/cs.ts": { matches: ["eigenweltlabs.com"], reason: "Text nápovedy LegalMemory (skrytá plocha)." },
  "apps/app/src/i18n/locales/de.ts": { matches: ["eigenweltlabs.com"], reason: "Text nápovedy LegalMemory (skrytá plocha)." },
  "apps/app/src/i18n/locales/en.ts": { matches: ["eigenweltlabs.com"], reason: "Text nápovedy LegalMemory (skrytá plocha)." },
  "apps/app/src/i18n/locales/sk.ts": { matches: ["eigenweltlabs.com"], reason: "Text nápovedy LegalMemory (skrytá plocha)." },
  "apps/app/src/react-app/domains/connections/eigenwelt-entitlements.ts": {
    matches: ["platform.eigenweltlabs.com"],
    reason: "Odkaz pre zobrazenie; dopyt je vypnutý, keď je skrytý eigenwelt-account, a server vráti prázdne pripojenie.",
  },
  "apps/app/src/react-app/domains/settings/pages/eigenwelt-account-view.tsx": {
    matches: ["platform.eigenweltlabs.com"],
    reason: "Záložka account je skrytá (HIDDEN_SETTINGS_TABS).",
  },
  "apps/app/src/react-app/domains/workspace/remote-workspace-diagnostics.ts": {
    matches: ["eigenweltlabs.com"],
    reason: "Kontaktný e-mail v texte chyby vzdialeného workspace (značka, nie spojenie).",
  },
  "apps/app/src/settings-preview.tsx": {
    matches: ["api.eigenweltlabs.com"],
    reason: "Vývojový náhľad nastavení so statickými dátami, nie je v appke.",
  },
  "apps/desktop/package.json": { matches: ["eigenweltlabs.com"], reason: "Autor balíka upstreamu (metadáta)." },
  "packages/legalwork-ui-mcp/package.json": { matches: ["eigenweltlabs.com"], reason: "Autor balíka upstreamu (metadáta)." },
  "apps/server/src/eigenwelt-auth.ts": {
    matches: ["platform.eigenweltlabs.com"],
    reason: "Prihlásenie do Eigenweltu; bez LAWOSS_EIGENWELT_ACCOUNT=1 sa pripojenie nečíta a manifest nesťahuje.",
  },
  "apps/server/src/file-storage/oauth/box.ts": {
    matches: ["platform.eigenweltlabs.com"],
    reason: "Box je skrytý, kým firma nemá vlastný LEGALWORK_STORAGE_BOX_OAUTH_URL (storageOAuthProviderAllowed).",
  },
  "apps/server/src/systemone.ts": {
    matches: ["api.eigenweltlabs.com"],
    reason: "Popis spravovaného poskytovateľa SystemOne; volá sa len s tokenom účtu, ktorý LAWOSS nečíta.",
  },
  "apps/server/src/word-addin.ts": { matches: ["eigenweltlabs.com"], reason: "SupportUrl v manifeste doplnku Office (odkaz)." },
  "apps/server/src/opencode-plugins/legalwork-anthropic-tool-schema.ts": {
    matches: ["posthog"],
    reason: "Komentár: príklad MCP servera so zložitou schémou.",
  },
  "lawoss/scripts/update-models-catalog.mjs": {
    matches: ["models.eigenweltlabs.com"],
    reason: "Komentár, že zrkadlo Eigenweltu je ako zdroj zakázané.",
  },
  "lawoss/scripts/check-no-eigenwelt.mjs": {
    matches: [
      "posthog",
      "eigenweltlabs.com",
      "platform.eigenweltlabs.com",
      "api.eigenweltlabs.com",
      "models.eigenweltlabs.com",
      "eu.i.posthog.com",
      "phc_mvbq5pbmknzpmln6c6bmzb9yxqetf6bvspzba5vwrjfw",
      "sentry.io",
      "@sentry/",
      "segment.io",
      "mixpanel",
      "amplitude.com",
      "bugsnag",
      "datadoghq",
    ],
    reason: "Tento skript: vzory a povolený zoznam.",
  },
};

/** Štrukturálne poistky: súbor musí (ne)obsahovať daný vzor. */
export const STRUCTURE = [
  {
    file: "apps/server/src/managed-opencode.ts",
    must: [/import \{ lawossEngineEnv \} from "\.\/lawoss\/engine-network\.js";/, /const lawossEnv = lawossEngineEnv\(\);/, /\.\.\.options\.env,\s*\.\.\.lawossEnv,/],
    why: "Engine musí dostať poistky LAWOSS ako posledné (bez sťahovania katalógu, zdieľania a aktualizácie).",
  },
  {
    file: "apps/server/src/lawoss/engine-network.ts",
    must: [/OPENCODE_DISABLE_MODELS_FETCH: "1"/, /OPENCODE_DISABLE_SHARE: "1"/, /OPENCODE_DISABLE_AUTOUPDATE: "1"/, /OPENCODE_MODELS_PATH: catalog/],
    mustNot: [/OPENCODE_MODELS_URL\s*:/],
    why: "Prostredie enginu LAWOSS.",
  },
  {
    file: "apps/server/src/embedded.ts",
    mustNot: [/OPENCODE_MODELS_URL\s*:/],
    why: "Desktop nesmie enginu posielať adresu katalógu.",
  },
  {
    file: "apps/server/src/cli.ts",
    mustNot: [/OPENCODE_MODELS_URL\s*:/],
    why: "Samostatný server nesmie enginu posielať adresu katalógu.",
  },
  {
    file: "apps/desktop/electron-builder.yml",
    must: [/- from: \.\.\/\.\.\/lawoss\/models-catalog\s+to: lawoss-models/],
    why: "Zabalená appka musí niesť katalóg mimo app.asar.",
  },
  {
    file: "apps/app/src/app/lib/analytics.ts",
    must: [/export function isAnalyticsEnabled\(\): boolean \{\s*return false;\s*\}/, /export function isAnalyticsSending\(\): boolean \{\s*return false;\s*\}/, /export async function flushAnalytics\(\): Promise<void> \{\}/],
    mustNot: [/\bfetch\s*\(/, /sendBeacon/, /XMLHttpRequest/, /https?:\/\//, /phc_/i, /VITE_LEGALWORK_POSTHOG/],
    why: "Analytika nesmie mať kľúč, adresu ani sieťové volanie.",
  },
  {
    file: "apps/app/src/lawoss/feature-flags.ts",
    must: [
      /export const isAnalyticsChoiceHidden = \(\): boolean => true;/,
      ...["ai-plans", "firm-hub", "trial-notice", "premium-upsell", "eigenwelt-account", "eigenwelt-sign-in", "eigenwelt-trial"].map(
        (surface) => new RegExp(`HIDDEN_COMMERCIAL_SURFACES[\\s\\S]*"${surface}",[\\s\\S]*\\]\\);\\s*\\n\\s*export const isCommercialSurfaceHidden`),
      ),
      /HIDDEN_SETTINGS_TABS[\s\S]*"account",/,
    ],
    why: "Prepínač analytiky a plochy Eigenweltu ostávajú skryté.",
  },
  {
    file: "apps/app/src/lawoss/domains/onboarding/ai-step.tsx",
    mustNot: [/analyticsEnabled|onAnalyticsChange|lib\/analytics/, /<Switch/],
    why: "Onboarding LAWOSS nemá voľbu analytiky.",
  },
  {
    file: "apps/server/src/lawoss/commercial-services.ts",
    must: [/export const eigenweltAccountEnabled = \(env: NodeJS\.ProcessEnv = process\.env\): boolean =>\s*env\[EIGENWELT_ACCOUNT_ENV\] === "1";/],
    why: "Účet Eigenwelt je predvolene vypnutý.",
  },
  {
    file: "apps/server/src/eigenwelt-connection-store.ts",
    must: [/eigenweltAccountEnabled\(\) \? \(await connectionDb\(config\)\)\.get\(ACCOUNT_ROW_ID\) : undefined/],
    why: "Uložené pripojenie Eigenweltu sa bez zapnutia nečíta.",
  },
  {
    file: "apps/server/src/eigenwelt-paid-manifest.ts",
    must: [/if \(!eigenweltAccountEnabled\(\)\) return null;/],
    why: "Platený manifest Eigenweltu sa bez zapnutia nečíta.",
  },
  {
    file: "apps/server/src/eigenwelt-auth.ts",
    must: [/if \(!eigenweltAccountEnabled\(\)\) throw new Error\(EIGENWELT_ACCOUNT_DISABLED_MESSAGE\);/],
    why: "Manifest Eigenweltu sa bez zapnutia nesťahuje.",
  },
  {
    file: "apps/server/src/legalwork-runtime-config.ts",
    must: [/\.\.\.\(eigenweltAccountEnabled\(\) \? \[\] : \[EIGENWELT_PROVIDER_ID\]\)/],
    why: "Engine má poskytovateľa eigenwelt vypnutého.",
  },
  {
    file: "apps/server/src/lawoss/commercial-services.ts",
    must: [/env\[EIGENWELT_FIRM_SERVICES_ENV\] === "1"/, /id !== "box" \|\| Boolean\(env\.LEGALWORK_STORAGE_BOX_OAUTH_URL\?\.trim\(\)\)/],
    why: "Firemné služby a Box broker Eigenweltu ostávajú vypnuté.",
  },
  {
    file: ".github/workflows/download-stats.yml",
    must: [/if: github\.repository == 'eigenweltlabs\/legalwork'/],
    why: "Štatistiky stiahnutí sa z forku neposielajú.",
  },
];

/** UI, ktoré renderuje prepínač analytiky, musí byť za `isAnalyticsChoiceHidden()`. */
const ANALYTICS_TOGGLE_KEYS = /t\("(?:settings\.analytics_toggle|welcome\.analytics_aria|welcome\.analytics_body)"\)/;

function trackedFiles(root) {
  const output = execFileSync("git", ["ls-files", "-z", "--", ...SCANNED_ROOTS], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return output.split("\0").filter(Boolean);
}

function readText(root, file) {
  try {
    const buffer = readFileSync(join(root, file));
    if (buffer.includes(0)) return null;
    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

/** Vráti zoznam problémov; prázdny zoznam znamená v poriadku. */
export function checkSources(root, files) {
  const problems = [];
  for (const file of files) {
    const path = file.split(sep).join("/");
    if (SKIPPED_FILE.test(path) || SKIPPED_PATH.test(path)) continue;
    const text = readText(root, file);
    if (text === null) continue;
    const found = new Set([...text.matchAll(FORBIDDEN)].map((match) => match[0].toLowerCase()));
    const allowed = new Set(ALLOWED[path]?.matches ?? []);
    for (const match of found) {
      if (!allowed.has(match)) problems.push(`${path}: nepovolený výskyt „${match}“ (Eigenwelt, PostHog alebo telemetria). Ak je to len mŕtvy kód alebo odkaz, doplň ho s dôvodom do ALLOWED.`);
    }
    if (path.startsWith("apps/app/src/") && ANALYTICS_TOGGLE_KEYS.test(text) && !text.includes("isAnalyticsChoiceHidden()")) {
      problems.push(`${path}: renderuje prepínač analytiky bez isAnalyticsChoiceHidden().`);
    }
  }
  return problems;
}

export function checkStructure(root) {
  const problems = [];
  for (const rule of STRUCTURE) {
    const text = readText(root, rule.file);
    if (text === null) {
      problems.push(`${rule.file}: chýba. ${rule.why}`);
      continue;
    }
    for (const pattern of rule.must ?? []) {
      if (!pattern.test(text)) problems.push(`${rule.file}: chýba ${pattern}. ${rule.why}`);
    }
    for (const pattern of rule.mustNot ?? []) {
      if (pattern.test(text)) problems.push(`${rule.file}: obsahuje ${pattern}. ${rule.why}`);
    }
  }
  return problems;
}

export function checkCatalog(path = CATALOG_PATH) {
  try {
    return validateCatalog(JSON.parse(readFileSync(path, "utf8"))).map((problem) => `${relative(REPO_ROOT, path)}: ${problem}`);
  } catch (error) {
    return [`${relative(REPO_ROOT, path)}: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") yield* walk(path);
    } else if (/\.(?:m?js|cjs|json|html)$/.test(entry.name) && !/\.test\./.test(entry.name) && statSync(path).size < 32 * 1024 * 1024) {
      yield path;
    }
  }
}

/** Buildnutý výstup, ak existuje (CI ho na Linuxe vytvorí pred týmto krokom). */
export function checkBuild(root, dirs = ["apps/server/dist", "apps/app/dist", "apps/desktop/server"]) {
  const problems = [];
  for (const dir of dirs) {
    const absolute = join(root, dir);
    if (!existsSync(absolute)) continue;
    for (const file of walk(absolute)) {
      const text = readFileSync(file, "utf8");
      for (const match of new Set([...text.matchAll(FORBIDDEN_IN_BUILD)].map((item) => item[0].toLowerCase()))) {
        problems.push(`${relative(root, file)}: buildnutý výstup obsahuje „${match}“.`);
      }
    }
  }
  return problems;
}

export function checkRepo(root = REPO_ROOT) {
  return [
    ...checkSources(root, trackedFiles(root)),
    ...checkStructure(root),
    ...checkCatalog(join(root, "lawoss", "models-catalog", "api.json")),
    ...checkBuild(root),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkRepo();
  if (problems.length) {
    console.error(`LAWOSS stráž Eigenweltu a analytiky: ${problems.length} problémov\n${problems.map((line) => `  - ${line}`).join("\n")}`);
    console.error("Postup: docs/upstream-sync-checklist.md");
    process.exit(1);
  }
  console.log("LAWOSS stráž Eigenweltu a analytiky: v poriadku.");
}
