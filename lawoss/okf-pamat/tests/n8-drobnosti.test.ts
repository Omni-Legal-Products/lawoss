import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { serializeRecord } from "../src/record.ts";
import { newRecord, planWrite, renderStatus, writeIndex, MEMORY_DIR } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

function spis(j: "cz" | "sk" = "cz"): string {
  const dir = mkdtempSync(join(tmpdir(), "okf-n8-"));
  mkdirSync(join(dir, MEMORY_DIR));
  writeFileSync(join(dir, "_STATUS.md"), "# Status\n");
  writeFileSync(join(dir, "matter.md"), `---\ntype: matter\njurisdiction: ${j}\n---\n`);
  return dir;
}

function zaznam(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "D-001", type: "decision", jurisdiction: "cz",
      title: "Rozhodnutie", summary: "s",
      created: "2026-09-01", updated: "2026-09-01", truth: "pôvodná pravda",
      timeline: [{ date: "2026-09-01", text: "založené" }],
    }),
    ...over,
  };
}

// --- N5: kód nálezu sa volá PARSE_ERROR ---

test("necitatelny subor sa hlasi ako PARSE_ERROR", () => {
  const dir = spis();
  writeFileSync(join(dir, MEMORY_DIR, "D-999-zly.md"), "---\nnieco: zle\n---\n");
  const r = runCli(["validate", dir]);
  assert.equal(r.code, 1);
  assert.match(r.out, /PARSE_ERROR/);
  assert.doesNotMatch(r.out, /ERROR PARSE /, "starý kód sa už nepoužíva");
});

// --- N8: typ sa cloveku ukazuje v jeho jazyku ---

test("projekcia ukazuje typ v jazyku pouzivatela, nie kanonicky", () => {
  const s = `# Status

## Záznamy
<!-- okf:render:records:start -->
<!-- okf:render:records:end -->
`;
  assert.match(renderStatus(s, [zaznam()], "cz"), /rozhodnutí/);
  assert.match(renderStatus(s, [zaznam()], "sk"), /rozhodnutie/);
  assert.doesNotMatch(renderStatus(s, [zaznam()], "cz"), /\| decision \|/);
});

test("INDEX.md ukazuje typ v jazyku pouzivatela", () => {
  const dir = spis("sk");
  writeFileSync(join(dir, MEMORY_DIR, "D-001.md"), serializeRecord(zaznam({ jurisdiction: "sk" })));
  writeIndex(dir);
  const idx = readFileSync(join(dir, MEMORY_DIR, "INDEX.md"), "utf8");
  assert.match(idx, /rozhodnutie/);
  assert.doesNotMatch(idx, /\| decision \|/);
});

test("read ukazuje typ v jazyku pouzivatela", () => {
  const dir = spis();
  writeFileSync(join(dir, MEMORY_DIR, "D-001.md"), serializeRecord(zaznam()));
  assert.match(runCli(["read", dir]).out, /rozhodnutí/);
});

// --- N8: zmena obsahu si vyžaduje bump `updated` ---

test("zmena pravdy bez bumpu updated je odmietnuta uz pri zapise", () => {
  const before = zaznam();
  const after = zaznam({
    truth: "nová pravda",
    timeline: [...before.timeline, { date: "2026-09-02", text: "obrat" }],
  });
  assert.throws(() => planWrite(before, after, "obrat"), /updated/i);
});

test("pribudnuty riadok historie bez bumpu updated je odmietnuty", () => {
  const before = zaznam();
  const after = zaznam({ timeline: [...before.timeline, { date: "2026-09-02", text: "udalosť" }] });
  assert.throws(() => planWrite(before, after, "nová udalosť"), /updated/i);
});

test("s bumpom updated zmena prejde", () => {
  const before = zaznam();
  const after = zaznam({
    truth: "nová pravda",
    updated: "2026-09-02",
    timeline: [...before.timeline, { date: "2026-09-02", text: "obrat" }],
  });
  assert.doesNotThrow(() => planWrite(before, after, "obrat"));
});

test("zmena, ktora obsah nemeni, bump nevyzaduje", () => {
  const before = zaznam();
  assert.doesNotThrow(() => planWrite(before, zaznam({ summary: "presnejší popis" }), "spresnenie"));
});

test("zalozenie zaznamu bump nevyzaduje", () => {
  assert.doesNotThrow(() => planWrite(undefined, zaznam(), "založenie"));
});

// --- N8: init ---

test("init zalozi adresar pamate, nielen BRAIN.md", () => {
  const dir = mkdtempSync(join(tmpdir(), "okf-init-"));
  writeFileSync(join(dir, "matter.md"), "---\ntype: matter\njurisdiction: sk\n---\n");
  runCli(["init", dir, "--apply"]);
  assert.ok(existsSync(join(dir, MEMORY_DIR)), "adresár pamäte má vzniknúť");
  assert.ok(existsSync(join(dir, "BRAIN.md")));
});

test("init berie jurisdikciu z karty veci, nie z prepinaca", () => {
  const dir = mkdtempSync(join(tmpdir(), "okf-init-sk-"));
  writeFileSync(join(dir, "matter.md"), "---\ntype: matter\njurisdiction: sk\n---\n");
  runCli(["init", dir, "--apply"]);
  const brain = readFileSync(join(dir, "BRAIN.md"), "utf8");
  assert.match(brain, /pamäte|Vstupný/, "SK spis má dostať slovenský BRAIN.md");
});

test("prepinac kartu prebije", () => {
  const dir = mkdtempSync(join(tmpdir(), "okf-init-ovr-"));
  writeFileSync(join(dir, "matter.md"), "---\ntype: matter\njurisdiction: sk\n---\n");
  runCli(["init", dir, "--cz", "--apply"]);
  assert.match(readFileSync(join(dir, "BRAIN.md"), "utf8"), /paměti|Vstupní/);
});

test("bez karty a bez prepinaca sa predpoklada cestina", () => {
  const dir = mkdtempSync(join(tmpdir(), "okf-init-def-"));
  runCli(["init", dir, "--apply"]);
  assert.match(readFileSync(join(dir, "BRAIN.md"), "utf8"), /paměti|Vstupní/);
});
