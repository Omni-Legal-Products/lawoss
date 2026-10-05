#!/usr/bin/env node
/**
 * LAWOSS: stráž značky.
 *
 * Rozhodnutie MČ 5. 10. 2026 (M3): appka sa volá LAWOSS a upstream sync ostáva
 * praktický. Značka má jeden zdroj, `lawoss/branding.mjs`; upstream súbory ju
 * importujú a miesta, ktoré importovať nevedia, stráži tento skript. Zlyhá, keď:
 *
 * 1. `apps/desktop/electron/lawoss-branding.mjs` nie je bajtovo zhodná kópia
 *    `lawoss/branding.mjs` (oprava: `node lawoss/scripts/check-branding.mjs --write`);
 * 2. sa zmení identita na disku: `APP_IDENTIFIER`, `appId`, schéma `legalwork://`
 *    alebo odvodenie priečinka s dátami (z identifikátora, nie z názvu);
 * 3. názov aplikácie (`APP_NAME`, `DISPLAY_NAME`, `productName`, `<title>`,
 *    predvolený názov v shelle, substitúcia v `t()`) nie je LAWOSS;
 * 4. text, ktorý advokát uvidí v slovníkoch sk, cs, en, de (po substitúcii v `t()`),
 *    alebo text v UI LAWOSS (`apps/app/src/lawoss/**`) obsahuje „LegalWork“
 *    mimo povoleného zoznamu `ALLOWED_TEXT`;
 * 5. appka alebo desktop odkazujú na releasy upstreamu alebo na legalwork.app.
 *
 * V CI beží spolu so strážou Eigenweltu (`check-no-eigenwelt.mjs`) v jobe
 * `legalwork-tests`. Postup pri upstream synci: `docs/upstream-sync-checklist.md`.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { BRAND_NAME, UPSTREAM_BRAND_NAME } from "../branding.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const BRANDING_SOURCE = "lawoss/branding.mjs";
export const BRANDING_DESKTOP_COPY = "apps/desktop/electron/lawoss-branding.mjs";

/** Identita na disku. Zmena by appku odpojila od doterajších dát, kľúčenky a odkazov. */
export const PINNED_IDENTITY = Object.freeze({
  bundleIdentifier: "com.eigenweltlabs.legalwork",
  devIdentifier: "com.eigenweltlabs.legalwork.dev",
  protocolScheme: "legalwork",
});

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Súbor musí (ne)obsahovať daný vzor. */
export const STRUCTURE = [
  {
    file: "apps/desktop/electron/main.mjs",
    must: [
      new RegExp(`const APP_BUNDLE_IDENTIFIER = "${escape(PINNED_IDENTITY.bundleIdentifier)}";`),
      new RegExp(`const DEV_APP_IDENTIFIER = "${escape(PINNED_IDENTITY.devIdentifier)}";`),
      new RegExp(`const DESKTOP_PROTOCOL_SCHEME = "${escape(PINNED_IDENTITY.protocolScheme)}";`),
      /const APP_IDENTIFIER =\s*process\.env\.LEGALWORK_ELECTRON_APP_IDENTIFIER\?\.trim\(\) \|\|\s*\(isDevMode \? DEV_APP_IDENTIFIER : APP_BUNDLE_IDENTIFIER\);/,
      /app\.setAppUserModelId\(APP_IDENTIFIER\);/,
      /app\.setPath\(\s*"userData",\s*path\.join\(app\.getPath\("appData"\), APP_IDENTIFIER\),?\s*\);/,
    ],
    why: "APP_IDENTIFIER, schéma legalwork:// a priečinok s dátami sa nemenia; z nich sa odvodzujú dáta advokáta.",
  },
  {
    file: "apps/desktop/electron/main.mjs",
    must: [
      /import \{[^}]*\bbrandAppName\b[^}]*\} from "\.\/lawoss-branding\.mjs";/,
      /const APP_NAME =\s*process\.env\.LEGALWORK_ELECTRON_APP_NAME\?\.trim\(\) \|\|\s*brandAppName\(isDevMode\);/,
      /const DISPLAY_NAME = brandAppName\(isDevMode\);/,
      /app\.setName\(APP_NAME\);/,
      /const RELEASE_PAGE_URL = FORK_RELEASES_URL;/,
    ],
    mustNot: [/"LegalWork(?: - Dev)?"/],
    why: "Názov procesu, menu a odkaz na releasy berie desktop z lawoss-branding.mjs.",
  },
  {
    file: "apps/desktop/electron-builder.yml",
    must: [
      new RegExp(`^appId: ${escape(PINNED_IDENTITY.bundleIdentifier)}$`, "m"),
      new RegExp(`^productName: ${escape(BRAND_NAME)}$`, "m"),
      new RegExp(`^protocols:\\n  - name: ${escape(BRAND_NAME)}\\n    schemes:\\n      - ${escape(PINNED_IDENTITY.protocolScheme)}$`, "m"),
    ],
    why: "appId ostáva, názov balíka a protokolu je LAWOSS.",
  },
  {
    file: "apps/desktop/electron/updater.mjs",
    must: [/stable: "https:\/\/lawoss\.app\/update"/, /alpha: alphaReleaseDownloadUrl\(/],
    why: "Updater sa pozerá na feed LAWOSS a alfa tagy forku.",
  },
  {
    file: "apps/desktop/electron/update-feed.mjs",
    must: [/import \{[^}]*FORK_RELEASE_DOWNLOAD_BASE_URL[^}]*\} from "\.\/lawoss-branding\.mjs";/],
    why: "Záložný zdroj inštalátorov sú releasy forku.",
  },
  {
    file: "apps/app/index.html",
    must: [new RegExp(`<title>${escape(BRAND_NAME)}</title>`)],
    why: "Titulok okna.",
  },
  {
    file: "apps/app/src/react-app/shell/shell-config.tsx",
    must: [new RegExp(`appName: "${escape(BRAND_NAME)}",`), new RegExp(`sidebarBrandName: "${escape(BRAND_NAME)}",`)],
    why: "Predvolený názov v shelle a v bočnom paneli.",
  },
  {
    file: "apps/app/src/i18n/index.ts",
    must: [
      /export const applyBrandName = \(text: string\): string => text\.replaceAll\(UPSTREAM_BRAND_NAME, BRAND_NAME\);/,
      /const branded = BRAND_EXEMPT_KEYS\.has\(key\) \? result : applyBrandName\(result\);/,
      /import \{ BRAND_NAME, UPSTREAM_BRAND_NAME \} from "\.\.\/lawoss\/branding";/,
    ],
    why: "t() nahrádza meno upstreamu za LAWOSS pri každom texte; nové upstream reťazce sú tak pokryté.",
  },
];

/**
 * Riadky `electron-builder.yml` (mimo komentárov), ktoré smú meno upstreamu niesť:
 * licenčná doložka a názvy pribalených pomocných binárok.
 */
export const BUILDER_ALLOWED_LINES = [
  /^copyright: ".*Based on LegalWork, Copyright © \d{4} Eigenwelt Labs\..*"$/,
  /^\s*- "LegalWork Computer Use\.app\/\*\*"$/,
  /^\s*- LegalWorkAudioTap$/,
  /^\s*- LegalWorkKeyMonitor$/,
];

/** Slovníky, ktoré advokát číta. `minEntries` chráni pred tichým nulovým rozborom. */
export const LOCALE_FILES = [
  { file: "apps/app/src/i18n/locales/sk.ts", minEntries: 1000 },
  { file: "apps/app/src/i18n/locales/cs.ts", minEntries: 1000 },
  { file: "apps/app/src/i18n/locales/en.ts", minEntries: 1000 },
  { file: "apps/app/src/i18n/locales/de.ts", minEntries: 1000 },
];

/** Slovníky LAWOSS. Píšu sa rovno s LAWOSS, na substitúciu sa nespoliehajú. */
export const LAWOSS_DICTIONARY_DIR = "apps/app/src/lawoss/i18n/";

/**
 * Kľúče, v ktorých advokát smie vidieť „LegalWork“ alebo podobný tvar, a dôvod.
 * Patrí sem každý kľúč z `BRAND_EXEMPT_KEYS` v `apps/app/src/i18n/index.ts`.
 */
export const ALLOWED_TEXT = {
  "mcp.quick_connect_legalmemory_desc": "Veta o dodávateľovi LegalMemory (výrobca LegalWorku); v BRAND_EXEMPT_KEYS, plocha je skrytá.",
  "benchmark.onboarding_headline": "Bežná anglická fráza „legal work“, nie značka.",
};

/** Súbory UI LAWOSS (okrem slovníkov), kde sa hľadá meno upstreamu v reťazcoch. */
const LAWOSS_UI = /^apps\/app\/src\/lawoss\/(?!i18n\/).*\.(?:ts|tsx)$/;

/** Zdroje appky a desktopu, kde nesmie ostať odkaz na releasy upstreamu. */
const URL_SCOPE = /^(?:apps\/app\/src|apps\/desktop\/electron)\//;
export const UPSTREAM_URL = /github\.com\/eigenweltlabs\/legalwork(?![\w-])|(?<![\w.-])legalwork\.app(?![\w.-])/g;

const SKIPPED_PATH = /(?:\.test\.|\.spec\.|\/tests?\/|\/__tests__\/|\/fixtures?\/|\.e2e\.)/;

function readText(root, file) {
  try {
    return readFileSync(join(root, file), "utf8");
  } catch {
    return null;
  }
}

function trackedFiles(root) {
  const output = execFileSync("git", ["ls-files", "-z", "--", "apps/app/src", "apps/desktop/electron"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return output.split("\0").filter(Boolean);
}

/** Dvojice `"kľúč": "hodnota"` zo slovníka; hodnota môže byť na ďalšom riadku. */
export function parseDictionary(text) {
  const entries = [];
  for (const match of text.matchAll(/"((?:[^"\\\n]|\\.)+)"\s*:\s*"((?:[^"\\\n]|\\.)*)"/g)) {
    entries.push([match[1], match[2]]);
  }
  return entries;
}

/** Kľúče z množiny `BRAND_EXEMPT_KEYS` v `i18n/index.ts`. */
export function parseExemptKeys(text) {
  const body = text?.match(/BRAND_EXEMPT_KEYS[^=]*=\s*new Set<string>\(\[([\s\S]*?)\]\)/)?.[1];
  if (body === undefined) return null;
  return new Set([...body.replace(/\/\/.*$/gm, "").matchAll(/"([^"]+)"/g)].map((match) => match[1]));
}

/** Text tak, ako ho vráti `t()`, bez strojových identifikátorov (premenné, schéma, nástroje). */
export function visibleBrandLeak(value, exempt) {
  const rendered = exempt ? value : value.replaceAll(UPSTREAM_BRAND_NAME, BRAND_NAME);
  const prose = rendered.replace(/LEGALWORK_[A-Z0-9_]*/g, "").replace(/[a-z0-9_./-]*legalwork[a-z0-9_./-]*(?::\/\/)?/g, "");
  return prose.match(/legal\s*work/i)?.[0] ?? null;
}

export function checkMirror(root) {
  const source = readText(root, BRANDING_SOURCE);
  const copy = readText(root, BRANDING_DESKTOP_COPY);
  if (source === null) return [`${BRANDING_SOURCE}: chýba. Je to jediný zdroj značky.`];
  if (copy !== source) {
    return [`${BRANDING_DESKTOP_COPY}: nie je zhodná kópia ${BRANDING_SOURCE}. Oprava: node lawoss/scripts/check-branding.mjs --write`];
  }
  return [];
}

export function checkStructure(root) {
  const problems = [];
  if (BRAND_NAME !== "LAWOSS" || /legal\s*work/i.test(BRAND_NAME)) problems.push(`${BRANDING_SOURCE}: BRAND_NAME je „${BRAND_NAME}“, rozhodnutie MČ 5. 10. 2026 je LAWOSS.`);
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
  const builder = readText(root, "apps/desktop/electron-builder.yml") ?? "";
  builder.split("\n").forEach((line, index) => {
    if (/^\s*#/.test(line) || !/legal\s*work/i.test(line.replace(/[a-z0-9_./-]*legalwork[a-z0-9_./${}-]*/g, ""))) return;
    if (!BUILDER_ALLOWED_LINES.some((pattern) => pattern.test(line))) {
      problems.push(`apps/desktop/electron-builder.yml:${index + 1}: „${line.trim()}“ nesie meno upstreamu. Ak je to len názov súboru alebo licencia, doplň BUILDER_ALLOWED_LINES.`);
    }
  });
  return problems;
}

export function checkLocales(root, lawossDictionaries = []) {
  const problems = [];
  const exempt = parseExemptKeys(readText(root, "apps/app/src/i18n/index.ts"));
  if (exempt === null) return ["apps/app/src/i18n/index.ts: nenašiel som BRAND_EXEMPT_KEYS."];
  for (const key of exempt) {
    if (!Object.hasOwn(ALLOWED_TEXT, key)) problems.push(`apps/app/src/i18n/index.ts: kľúč „${key}“ v BRAND_EXEMPT_KEYS chýba v ALLOWED_TEXT stráže značky s dôvodom.`);
  }
  for (const { file, minEntries } of LOCALE_FILES) {
    const text = readText(root, file);
    if (text === null) {
      problems.push(`${file}: chýba.`);
      continue;
    }
    const entries = parseDictionary(text);
    if (entries.length < minEntries) problems.push(`${file}: rozobral som len ${entries.length} textov (čakám aspoň ${minEntries}). Zmenil sa formát slovníka?`);
    for (const [key, value] of entries) {
      const leak = visibleBrandLeak(value, exempt.has(key));
      if (leak && !Object.hasOwn(ALLOWED_TEXT, key)) problems.push(`${file}: „${key}“ ukáže advokátovi „${leak}“. Oprav text alebo doplň ALLOWED_TEXT s dôvodom.`);
    }
  }
  for (const file of lawossDictionaries) {
    const entries = parseDictionary(readText(root, file) ?? "");
    for (const [key, value] of entries) {
      const leak = visibleBrandLeak(value, true);
      if (leak && !Object.hasOwn(ALLOWED_TEXT, key)) problems.push(`${file}: „${key}“ obsahuje „${leak}“. Texty LAWOSS píšu LAWOSS priamo.`);
    }
  }
  return problems;
}

/** Bez komentárov, aby vysvetlenia pôvodu kódu neboli nález. */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

export function checkSources(root, files) {
  const problems = [];
  for (const file of files) {
    const path = file.split(sep).join("/");
    if (SKIPPED_PATH.test(path)) continue;
    const ui = LAWOSS_UI.test(path);
    const urls = URL_SCOPE.test(path) && /\.(?:ts|tsx|mjs|cjs|js|html)$/.test(path) && path !== BRANDING_DESKTOP_COPY;
    if (!ui && !urls) continue;
    const text = readText(root, file);
    if (text === null) continue;
    const code = withoutComments(text);
    if (ui) {
      for (const match of new Set(code.match(/LegalWork|Legal Work/g) ?? [])) problems.push(`${path}: UI LAWOSS obsahuje „${match}“. Použi BRAND_NAME z @/lawoss/branding alebo t().`);
    }
    if (urls) {
      for (const match of new Set(code.match(UPSTREAM_URL) ?? [])) problems.push(`${path}: odkaz na upstream „${match}“. Releasy forku sú v lawoss/branding.mjs (FORK_RELEASES_URL).`);
    }
  }
  return problems;
}

export function checkBranding(root = REPO_ROOT) {
  const files = trackedFiles(root);
  return [
    ...checkMirror(root),
    ...checkStructure(root),
    ...checkLocales(root, files.filter((file) => file.startsWith(LAWOSS_DICTIONARY_DIR) && file.endsWith(".ts"))),
    ...checkSources(root, files),
  ];
}

/** Obnoví desktopovú kópiu z jediného zdroja. */
export function writeMirror(root = REPO_ROOT) {
  copyFileSync(join(root, BRANDING_SOURCE), join(root, BRANDING_DESKTOP_COPY));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--write")) writeMirror();
  const problems = checkBranding();
  if (problems.length) {
    console.error(`LAWOSS stráž značky: ${problems.length} problémov\n${problems.map((line) => `  - ${line}`).join("\n")}`);
    console.error("Postup: docs/upstream-sync-checklist.md");
    process.exit(1);
  }
  console.log("LAWOSS stráž značky: v poriadku.");
}
