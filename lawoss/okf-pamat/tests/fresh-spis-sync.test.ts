/**
 * E2E: spis založený `okf apply` musí prejsť `okf-memory init` + `sync` bez
 * KONFLIKTU (lawoss#48). Predtým mala `_STATUS.md` šablóna holé nadpisy
 * sekcií Lehoty/Chronológia bez markerov — `render` na ne narazil a hlásil
 * KONFLIKT na každom desiatom spise z ISIR (10/10).
 *
 * Prečo si tento test nepožičia `okf/src/fs.ts`/`planEntity`: `fs.ts` (cez
 * `templates.ts`) importuje šablóny Bun-only `import … with { type: "text" }`,
 * čo pod `node --test` (Node bez Bunu) zlyhá na `ERR_UNKNOWN_FILE_EXTENSION`.
 * A `core.ts` (bezzávislostné, dalo by sa importovať) má pod `okf-pamat`
 * prísnejším `noUncheckedIndexedAccess` odhalené existujúce typové chyby
 * v `planEntity`/`parseFrontmatter`, ktoré s touto úlohou nesúvisia — `okf`
 * samo typecheck nespúšťa. Test preto reprodukuje `apply` len v rozsahu,
 * ktorý potrebuje: reálne súbory šablóny `spis` s `{{PLACEHOLDER}}` substitúciou
 * identickou s `core.ts#renderTemplate`, zapísané rovno na disk.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli } from "../src/cli.ts";

const SPIS_TEMPLATES_DIR = join(import.meta.dirname, "../../okf/templates/spis");
const readTemplate = (name: string): string => readFileSync(join(SPIS_TEMPLATES_DIR, name), "utf8");

/** Identické s `okf/src/core.ts#renderTemplate` — neznáme kľúče sa vyprázdnia. */
function renderTemplate(template: string, vars: Readonly<Record<string, string | undefined>>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

/** Zapíše spis presne tak, ako by ho vytvoril `okf apply --type spis` do prázdneho priečinka. */
function applyFreshSpis(dir: string, title: string): void {
  const vars = { TITLE: title, DATE: "2026-09-19" };
  mkdirSync(dir, { recursive: true });
  const agents = renderTemplate(readTemplate("AGENTS.md"), vars);
  writeFileSync(join(dir, "spis.md"), renderTemplate(readTemplate("spis.md"), vars), "utf8");
  writeFileSync(join(dir, "_STATUS.md"), renderTemplate(readTemplate("_STATUS.md"), vars), "utf8");
  writeFileSync(join(dir, "AGENTS.md"), agents, "utf8");
  writeFileSync(join(dir, "MEMORY.md"), renderTemplate(readTemplate("MEMORY.md"), vars), "utf8");
  writeFileSync(join(dir, "CLAUDE.md"), agents, "utf8");
}

test("čerstvý spis: apply → init → sync bez KONFLIKTU", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "okf-fresh-")), "vec");
  applyFreshSpis(dir, "Testovacia vec");

  const initResult = runCli(["init", dir, "--cz", "--apply"]);
  assert.equal(initResult.code, 0, initResult.out);

  const syncResult = runCli(["sync", dir, "--apply"]);
  assert.equal(syncResult.code, 0, syncResult.out);
  assert.ok(!syncResult.out.includes("KONFLIKT"), syncResult.out);

  const status = readFileSync(join(dir, "_STATUS.md"), "utf8");
  assert.match(status, /<!-- okf:render:deadlines:start -->/);
});
