// N-A8-2 (regresia 30. 10. 2026): agent písal „Nastavenia → AI Providers → Text recognition from scans (OCR)“ a radil
// „Autorizujte priečinok … v Settings > Permissions“. Naše texty pre model (LAWOSS moduly servera a pluginy) preto
// nesmú niesť anglické názvy nastavení a zdedený prompt schopností nesmie radiť povoliť nadradený priečinok.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AI_PROVIDERS_SETTING, APP_NAMES_SYSTEM, OCR_SETTING } from "./app-setting-names.js";
import { OCR_DISABLED } from "./ocr-opt-in.js";

const ENGLISH_SETTINGS = /Settings ?(?:>|→)|(?:>|→) ?Permissions|AI Providers|Text recognition/;
const here = import.meta.dir;
const plugins = join(here, "..", "opencode-plugins");

/** Kód bez komentárov: riadky `//`, ` * ` a `/**` sú poznámky pre vývojárov, model ich nevidí. */
const code = (file: string): string[] => readFileSync(file, "utf8").split("\n").filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line));
const sources = [
  ...readdirSync(here).filter((name) => name.endsWith(".ts") && !name.includes(".test.")).map((name) => join(here, name)),
  ...readdirSync(plugins).filter((name) => name.startsWith("lawoss-") && name.endsWith(".ts") && !name.includes(".test.")).map((name) => join(plugins, name)),
];

test("naše texty pre model nemajú anglické názvy nastavení", () => {
  expect(sources.length).toBeGreaterThan(20);
  const found = sources.flatMap((file) => code(file).filter((line) => ENGLISH_SETTINGS.test(line)).map((line) => `${file}: ${line.trim()}`));
  expect(found).toEqual([]);
  for (const text of [OCR_DISABLED, OCR_SETTING, AI_PROVIDERS_SETTING, APP_NAMES_SYSTEM]) expect(text).not.toMatch(ENGLISH_SETTINGS);
  expect(OCR_DISABLED).toContain("Nastavenia → Poskytovatelia AI → Rozpoznávanie textu zo skenov (OCR)");
});

test("prompt schopností neradí „Settings > Permissions“ ani povoliť nadradený priečinok", () => {
  const knowledge = readFileSync(join(plugins, "legalwork-capabilities-knowledge.ts"), "utf8");
  expect(knowledge).not.toContain("Settings > Permissions");
  expect(knowledge).not.toContain("authorize the specific folder or its parent");
  expect(knowledge).toContain("Never ask the user to authorize a folder above the client's folder, a folder that contains other clients' folders, or a folder of another client.");
});
