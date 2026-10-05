#!/usr/bin/env node
/**
 * LAWOSS: obnoví pribalenú záložnú kópiu katalógu LAWOSS Marketplace
 * `apps/app/src/lawoss/domains/marketplace/marketplace-snapshot.json`.
 *
 * Kanonický katalóg je repozitár `Omni-Legal-Products/lawoss-marketplace`
 * (`lawoss-catalog.json`: kategórie, jurisdikcie, balíky, názvy SK/CZ/EN/DE;
 * `.claude-plugin/marketplace.json`: verzie). Appka zoznam pluginov ani kategórií
 * v kóde nedrží; číta túto kópiu, aby katalóg fungoval aj offline. Skript spúšťa
 * správca z lokálneho checkoutu marketplace, nič nesťahuje.
 *
 * Použitie:
 *   node lawoss/scripts/update-marketplace-snapshot.mjs --from <checkout> --ref <SHA na GitHube> \
 *     [--metadata-ref <SHA, z ktorého sú metadáta>] [--pending <plugin,plugin>]
 *   node lawoss/scripts/update-marketplace-snapshot.mjs --check
 *
 * `--ref` je jeden pripnutý commit pre všetky pluginy (inštaluje sa z neho).
 * `--pending` označí pluginy, ktoré na `--ref` ešte nie sú (napríklad pred pushom):
 * katalóg ich ukáže, inštalácia hneď povie, že balík nie je pripnutý.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SNAPSHOT_PATH = resolve(repoRoot, "apps/app/src/lawoss/domains/marketplace/marketplace-snapshot.json");
export const MARKETPLACE_REPOSITORY = "Omni-Legal-Products/lawoss-marketplace";
const SHA = /^[a-f0-9]{40}$/;
const LOCALES = ["sk", "cs", "en", "de"];

/** Vráti zoznam problémov; prázdny = v poriadku. */
export function validateSnapshot(snapshot) {
  const problems = [];
  if (snapshot?.schemaVersion !== 1) problems.push("schemaVersion musí byť 1");
  if (snapshot?.repository !== MARKETPLACE_REPOSITORY) problems.push(`repository musí byť ${MARKETPLACE_REPOSITORY}`);
  if (!SHA.test(snapshot?.ref ?? "")) problems.push("ref musí byť 40-znakový SHA");
  const categories = new Map((snapshot?.categories ?? []).map((category) => [category.id, category.kind]));
  const names = new Set();
  for (const plugin of snapshot?.plugins ?? []) {
    names.add(plugin.name);
    if (!/^plugins\/[a-z0-9-]+$/.test(plugin.path ?? "")) problems.push(`${plugin.name}: neplatná cesta`);
    if (plugin.ref !== null && plugin.ref !== snapshot.ref) problems.push(`${plugin.name}: ref sa líši od spoločného SHA`);
    if (!["jurisdiction", "general"].includes(categories.get(plugin.category))) problems.push(`${plugin.name}: neznáma kategória`);
    if (!["mcp-skill-cli", "skill-only"].includes(plugin.kind)) problems.push(`${plugin.name}: neznámy druh`);
    for (const locale of LOCALES) {
      if (!plugin.title?.[locale] || !plugin.summary?.[locale]) problems.push(`${plugin.name}: chýba text ${locale}`);
    }
  }
  for (const bundle of snapshot?.bundles ?? []) {
    for (const name of bundle.plugins ?? []) if (!names.has(name)) problems.push(`${bundle.id}: neznámy plugin ${name}`);
  }
  if (!names.size) problems.push("katalóg je prázdny");
  return problems;
}

export async function buildSnapshot({ from, ref, metadataRef = ref, pending = [] }) {
  const read = async (path) => JSON.parse(await readFile(join(from, path), "utf8"));
  const lawoss = await read("lawoss-catalog.json");
  const claude = await read(".claude-plugin/marketplace.json");
  const ledger = await read("releases.json");
  const skillOnly = new Set((ledger.inRepoSkills ?? []).map((record) => record.name));
  const versions = new Map(claude.plugins.map((plugin) => [plugin.name, { version: plugin.version, source: plugin.source }]));
  const plugins = Object.entries(lawoss.plugins).map(([name, meta]) => {
    const entry = versions.get(name);
    if (!entry) throw new Error(`${name} chýba v .claude-plugin/marketplace.json`);
    return {
      name,
      version: entry.version,
      path: entry.source.replace(/^\.\//, ""),
      ref: pending.includes(name) ? null : ref,
      kind: skillOnly.has(name) ? "skill-only" : "mcp-skill-cli",
      category: meta.category,
      jurisdictions: meta.jurisdictions,
      title: meta.title,
      summary: meta.summary,
    };
  });
  return {
    schemaVersion: 1,
    name: lawoss.name,
    repository: MARKETPLACE_REPOSITORY,
    ref,
    metadataRef,
    categories: lawoss.categories,
    plugins,
    bundles: lawoss.bundles ?? [],
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const problems = validateSnapshot(JSON.parse(await readFile(SNAPSHOT_PATH, "utf8")));
    if (problems.length) {
      console.error(`Katalóg LAWOSS Marketplace: ${problems.join("; ")}`);
      process.exit(1);
    }
    console.log("Katalóg LAWOSS Marketplace: v poriadku.");
  } else {
    const from = argument("--from");
    const ref = argument("--ref");
    if (!from || !ref || !SHA.test(ref)) {
      console.error("Použitie: --from <checkout marketplace> --ref <40-znakový SHA> [--metadata-ref <SHA>] [--pending a,b]");
      process.exit(2);
    }
    const metadataRef = argument("--metadata-ref") ?? ref;
    const pending = (argument("--pending") ?? "").split(",").filter(Boolean);
    const snapshot = await buildSnapshot({ from: resolve(from), ref, metadataRef, pending });
    const problems = validateSnapshot(snapshot);
    if (problems.length) {
      console.error(problems.join("\n"));
      process.exit(1);
    }
    await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`Zapísané: ${snapshot.plugins.length} pluginov, ${snapshot.bundles.length} balíky, ref ${ref}${pending.length ? `, čaká: ${pending.join(", ")}` : ""}.`);
  }
}
