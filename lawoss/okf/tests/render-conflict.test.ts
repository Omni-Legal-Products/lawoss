import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStatus, RenderConflictError } from "../src/render.ts";
import { newRecord } from "../src/index.ts";

const ZAZNAM = newRecord({
  id: "D-001", type: "decision", jurisdiction: "sk",
  title: "Rozhodnutie", summary: "s", created: "2026-09-01", updated: "2026-09-01",
  truth: "t", timeline: [{ date: "2026-09-01", text: "z" }],
  deadlines: ["2026-09-12"],
});

/** Šablóna mc-novy-spis: sekcie sú číslované a markery v nich zatiaľ nie sú. */
const SABLONA_MC = `# Vec — Status (SSOT)

## 3. Lehoty
| Dátum | Typ |
|---|---|

## 4. Chronológia
| Dátum | Udalosť |
|---|---|
`;

const S_MARKERMI = `# Vec — Status (SSOT)

## 3. Lehoty
<!-- okf:render:deadlines:start -->
<!-- okf:render:deadlines:end -->

## 4. Chronológia
<!-- okf:render:timeline:start -->
<!-- okf:render:timeline:end -->
`;

test("nadpis bez markerov skonci chybou, nie tichym duplikatom", () => {
  assert.throws(() => renderStatus(SABLONA_MC, [ZAZNAM], "sk"), RenderConflictError);
});

test("chyba pomenuje sekciu aj odporucany krok", () => {
  try {
    renderStatus(SABLONA_MC, [ZAZNAM], "sk");
    assert.fail("malo vyhodiť výnimku");
  } catch (e) {
    assert.ok(e instanceof RenderConflictError);
    assert.match((e as Error).message, /Lehoty/);
    assert.match((e as Error).message, /retrofit/i);
  }
});

test("cislovanie sekcie prekazkou nie je", () => {
  const bezCisla = SABLONA_MC.replace("## 3. Lehoty", "## Lehoty");
  assert.throws(() => renderStatus(bezCisla, [ZAZNAM], "sk"), RenderConflictError);
});

test("ceska sablona sa pozna rovnako ako slovenska", () => {
  const cz = "# Status\n\n## 3. Lhůty\n\n## 4. Chronologie\n";
  assert.throws(() => renderStatus(cz, [ZAZNAM], "cz"), RenderConflictError);
});

test("s markermi vnutri existujucej sekcie render prejde a neduplikuje", () => {
  const out = renderStatus(S_MARKERMI, [ZAZNAM], "sk");
  assert.match(out, /2026-09-12/);
  assert.equal((out.match(/^## /gm) ?? []).length, 2, "nesmie pribudnúť nadpis");
  assert.equal(renderStatus(out, [ZAZNAM], "sk"), out, "render musí byť idempotentný");
});

test("blok records sa uz do _STATUS.md sam nepridava", () => {
  const out = renderStatus(S_MARKERMI, [ZAZNAM], "sk");
  assert.doesNotMatch(out, /okf:render:records/,
    "zoznam záznamov patrí do INDEX.md, nie do _STATUS.md (O1, stanovisko MČ)");
});

test("blok records sa vyplni, ak si ho advokat markerom vyziada", () => {
  const s = `# Status

## Záznamy
<!-- okf:render:records:start -->
<!-- okf:render:records:end -->
`;
  assert.match(renderStatus(s, [ZAZNAM], "sk"), /D-001/);
});

test("uplne prazdny subor dostane sekcie doplnene", () => {
  const out = renderStatus("# Status\n", [ZAZNAM], "sk");
  assert.match(out, /okf:render:deadlines:start/);
  assert.match(out, /2026-09-12/);
});

test("nadpis, ktory sekciu len pripomina, poplach nespusti", () => {
  const s = "# Status\n\n## Lehoty a termíny klienta\n\ntext\n";
  assert.doesNotThrow(() => renderStatus(s, [ZAZNAM], "sk"),
    "zhoda musí byť na celý nadpis, nie na jeho začiatok");
});

// --- CLI ---

test("sync nad sablonou bez markerov skonci citatelne, nie stack tracom", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { runCli } = await import("../src/cli.ts");
  const { serializeRecord } = await import("../src/record.ts");
  const { memoryDirName } = await import("../src/index.ts");

  const dir = mkdtempSync(join(tmpdir(), "okf-konflikt-"));
  mkdirSync(join(dir, memoryDirName("sk")));
  writeFileSync(join(dir, "_STATUS.md"), SABLONA_MC);
  writeFileSync(join(dir, "pamat", "D-001.md"), serializeRecord(ZAZNAM));

  const pred = readFileSync(join(dir, "_STATUS.md"), "utf8");
  const r = runCli(["sync", dir, "--apply"]);

  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /KONFLIKT/);
  assert.match(r.out, /retrofit/i);
  assert.doesNotMatch(r.out, /at renderStatus|node:internal/);
  assert.equal(readFileSync(join(dir, "_STATUS.md"), "utf8"), pred,
    "pri konflikte sa súbor nesmie zmeniť");
});

test("aj dry-run sync konflikt ohlasi, nie az --apply", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { runCli } = await import("../src/cli.ts");
  const { serializeRecord } = await import("../src/record.ts");
  const { memoryDirName } = await import("../src/index.ts");

  const dir = mkdtempSync(join(tmpdir(), "okf-konflikt-dry-"));
  mkdirSync(join(dir, memoryDirName("sk")));
  writeFileSync(join(dir, "_STATUS.md"), SABLONA_MC);
  writeFileSync(join(dir, "pamat", "D-001.md"), serializeRecord(ZAZNAM));

  const r = runCli(["sync", dir]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /KONFLIKT/);
});
