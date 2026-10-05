#!/usr/bin/env node
/**
 * LAWOSS: obnoví pribalený katalóg modelov `lawoss/models-catalog/api.json`.
 *
 * Appka katalóg nikdy nesťahuje: engine dostane `OPENCODE_MODELS_PATH` na tento
 * súbor a `OPENCODE_DISABLE_MODELS_FETCH=1` (apps/server/src/lawoss/engine-network.ts).
 * Obnovu spúšťa správca ručne pred alfou, betou alebo zvýšením verzie OpenCode
 * a výsledok ide do PR ako bežná zmena súboru.
 *
 * Použitie:
 *   node lawoss/scripts/update-models-catalog.mjs                    # verejný katalóg OpenCode
 *   node lawoss/scripts/update-models-catalog.mjs --from <súbor|URL> # iný zdroj vo formáte api.json
 *   node lawoss/scripts/update-models-catalog.mjs --check            # len overí pribalený súbor
 *
 * Zdroj nesmie byť zrkadlo Eigenweltu (`models.eigenweltlabs.com`): skript ho odmietne.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CATALOG_PATH = resolve(repoRoot, "lawoss", "models-catalog", "api.json");
export const DEFAULT_SOURCE = "https://models.opencode.ai/api.json";

/** Modely, bez ktorých alfa neprejde: odporúčaný model predplatného ChatGPT. */
export const REQUIRED_MODELS = [["openai", "gpt-6-luna"]];

const FORBIDDEN_SOURCE = /eigenwelt|legalwork/i;

/** Rovnaký obsah dá rovnaký súbor: kľúče zoradené, bez medzier. */
export function serializeCatalog(catalog) {
  const sort = (value) => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
    }
    return value;
  };
  return `${JSON.stringify(sort(catalog))}\n`;
}

/** Chyby katalógu ako zoznam viet; prázdny zoznam znamená v poriadku. */
export function validateCatalog(catalog) {
  const problems = [];
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return ["katalóg nie je objekt poskytovateľov"];
  const providers = Object.keys(catalog);
  if (providers.length < 10) problems.push(`katalóg má len ${providers.length} poskytovateľov`);
  for (const [provider, model] of REQUIRED_MODELS) {
    if (!catalog[provider]?.models?.[model]) problems.push(`chýba ${provider}/${model}`);
  }
  if (FORBIDDEN_SOURCE.test(JSON.stringify(catalog))) problems.push("katalóg obsahuje odkaz na Eigenwelt alebo LegalWork");
  return problems;
}

function summarize(before, after) {
  if (!before) return ["Prvý pribalený katalóg."];
  const lines = [];
  const providers = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of [...providers].sort()) {
    const was = Object.keys(before[id]?.models ?? {});
    const now = Object.keys(after[id]?.models ?? {});
    const added = now.filter((model) => !was.includes(model));
    const removed = was.filter((model) => !now.includes(model));
    if (added.length) lines.push(`+ ${id}: ${added.join(", ")}`);
    if (removed.length) lines.push(`- ${id}: ${removed.join(", ")}`);
  }
  return lines;
}

async function readSource(source) {
  if (FORBIDDEN_SOURCE.test(source)) throw new Error(`Zdroj ${source} je zrkadlo dodávateľa upstreamu, LAWOSS ho nepoužíva.`);
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source, { headers: { "User-Agent": "lawoss-models-catalog" } });
    if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
    return JSON.parse(await response.text());
  }
  return JSON.parse(await readFile(resolve(source), "utf8"));
}

async function main(argv) {
  const check = argv.includes("--check");
  const fromIndex = argv.indexOf("--from");
  const source = fromIndex >= 0 ? argv[fromIndex + 1] : DEFAULT_SOURCE;
  const current = JSON.parse(await readFile(CATALOG_PATH, "utf8").catch(() => "null"));

  if (check) {
    const problems = validateCatalog(current);
    if (problems.length) throw new Error(`Pribalený katalóg nevyhovuje: ${problems.join("; ")}`);
    console.log(`Katalóg ${CATALOG_PATH}: ${Object.keys(current).length} poskytovateľov, v poriadku.`);
    return;
  }

  const next = await readSource(source);
  const problems = validateCatalog(next);
  if (problems.length) throw new Error(`Nový katalóg nevyhovuje: ${problems.join("; ")}`);
  await writeFile(CATALOG_PATH, serializeCatalog(next), "utf8");
  const changes = summarize(current, next);
  console.log(`Zapísané ${CATALOG_PATH} zo zdroja ${source}: ${Object.keys(next).length} poskytovateľov.`);
  console.log(changes.length ? changes.join("\n") : "Zoznam modelov sa nezmenil.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
