import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { serializeRecord, parseRecord } from "../src/record.ts";
import { newRecord, memoryDirName, authorize, planWrite, ApprovalRequiredError } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

function spis(): string {
  const dir = mkdtempSync(join(tmpdir(), "okf-write-"));
  mkdirSync(join(dir, memoryDirName("cz")));
  writeFileSync(join(dir, "_STATUS.md"), "# Status\n");
  return dir;
}

function rozhodnutie(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "D-001", type: "decision", jurisdiction: "cz",
      title: "Nenapadat prislusnost", summary: "zdrzeni prevazuje",
      created: "2026-09-01", updated: "2026-09-01", truth: "Nenapadame.",
      timeline: [{ date: "2026-09-01", text: "rozhodnuto" }],
    }),
    ...over,
  };
}

function poucenie(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "L-001", type: "lesson", jurisdiction: "cz",
      title: "Prislusnost overovat pred podanim", summary: "poucenie do praxe",
      created: "2026-09-01", updated: "2026-09-01", truth: "Overit sidlo pred podanim.",
      timeline: [{ date: "2026-09-01", text: "vzniklo z veci" }],
    }),
    ...over,
  };
}

/** Uloží navrhovaný stav záznamu do súboru, ktorý dostane CLI. */
function navrh(dir: string, r: OkfRecord): string {
  const path = join(dir, "navrh.md");
  writeFileSync(path, serializeRecord(r));
  return path;
}

const pocet = (dir: string) => readdirSync(join(dir, "pamet")).filter((f) => f.endsWith(".md")).length;

// --- náhľad ---

test("write bez --apply vypise diff a nic nezapise", () => {
  const dir = spis();
  const r = runCli(["write", dir, "--file", navrh(dir, rozhodnutie()), "--reason", "nove rozhodnutie"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /D-001/);
  assert.match(r.out, /dry-run/i);
  assert.equal(pocet(dir), 0, "náhľad nesmie nič zapísať");
});

test("nahlad povie, ze zapis bude vyzadovat schvalenie", () => {
  const dir = spis();
  const r = runCli(["write", dir, "--file", navrh(dir, poucenie()), "--reason", "povysenie"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /schválen/i);
  assert.match(r.out, /L1/);
});

// --- zápis do L2 ---

test("write --apply zapise L2 zaznam bez schvalenia", () => {
  const dir = spis();
  const r = runCli(["write", dir, "--file", navrh(dir, rozhodnutie()), "--reason", "nove", "--apply"]);
  assert.equal(r.code, 0, r.out);
  assert.equal(pocet(dir), 1);
});

// --- human gate ---

test("zapis do L1 bez --approve-as skonci chybou a povie, co chyba", () => {
  const dir = spis();
  const r = runCli(["write", dir, "--file", navrh(dir, poucenie()), "--reason", "povysenie", "--apply"]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /--approve-as/);
  assert.equal(pocet(dir), 0, "odmietnutý zápis nesmie nič vytvoriť");
});

test("zapis do L1 s --approve-as prejde", () => {
  const dir = spis();
  const r = runCli([
    "write", dir, "--file", navrh(dir, poucenie()), "--reason", "povysenie",
    "--apply", "--approve-as", "JUDr. Vojtěch Říha",
  ]);
  assert.equal(r.code, 0, r.out);
  assert.equal(pocet(dir), 1);
});

test("schvalenie sa zapise do append-only historie zaznamu", () => {
  const dir = spis();
  runCli([
    "write", dir, "--file", navrh(dir, poucenie()), "--reason", "povysenie z veci Novak",
    "--apply", "--approve-as", "JUDr. Vojtěch Říha",
  ]);
  const subor = readdirSync(join(dir, "pamet")).find((f) => f.startsWith("L-001"));
  assert.ok(subor);
  const ulozeny = parseRecord(readFileSync(join(dir, "pamet", subor), "utf8"));
  const audit = ulozeny.timeline.at(-1);
  assert.ok(audit, "audit riadok chýba");
  assert.match(audit.text, /JUDr\. Vojtěch Říha/);
  assert.match(audit.text, /povysenie z veci Novak/);
  assert.equal(ulozeny.timeline.length, 2, "pôvodná história musí zostať");
});

// --- audit nesmie oslabiť bránu atomicity ---

test("audit riadok nenahradi stopu zmeny Pravdy", () => {
  const dir = spis();
  const p = poucenie();
  runCli(["write", dir, "--file", navrh(dir, p), "--reason", "zalozenie",
          "--apply", "--approve-as", "JUDr. Vojtěch Říha"]);

  // Zmena Pravdy bez pridaného riadku histórie — audit riadok, ktorý CLI
  // pridáva samo, to nesmie zachrániť.
  const bezStopy = { ...p, truth: "Uplne inak." };
  const r = runCli(["write", dir, "--file", navrh(dir, bezStopy), "--reason", "obrat",
                    "--apply", "--approve-as", "JUDr. Vojtěch Říha"]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Historie|História/);
});

// --- validácia vstupu ---

test("chybajuci --file alebo --reason konci kodom 2 s napovedou", () => {
  const dir = spis();
  assert.equal(runCli(["write", dir, "--reason", "x"]).code, 2);
  assert.equal(runCli(["write", dir, "--file", navrh(dir, rozhodnutie())]).code, 2);
  assert.match(runCli(["write", dir, "--reason", "x"]).out, /--file/);
});

test("neexistujuci subor navrhu konci kodom 2, nie stack tracom", () => {
  const dir = spis();
  const r = runCli(["write", dir, "--file", join(dir, "niet.md"), "--reason", "x"]);
  assert.equal(r.code, 2);
  assert.doesNotMatch(r.out, /node:internal|ENOENT: no such/);
});

// --- authorize: čas musí byť čas ---

test("schvalenie s nezmyselnym casom neprejde", () => {
  const diff = planWrite(undefined, poucenie(), "povysenie");
  assert.throws(() => authorize(diff, { by: "JUDr. Vojtěch Říha", at: "vcera" }), ApprovalRequiredError);
});

test("schvalenie s platnym ISO casom prejde", () => {
  const diff = planWrite(undefined, poucenie(), "povysenie");
  assert.doesNotThrow(() => authorize(diff, { by: "JUDr. Vojtěch Říha", at: "2026-09-01T10:00:00Z" }));
});

test("hlavicka diffu je gramaticky spravna pre kazdy druh zapisu", () => {
  const dir = spis();
  const r = rozhodnutie();

  assert.match(
    runCli(["write", dir, "--file", navrh(dir, r), "--reason", "x"]).out,
    /^Nový záznam D-001/m,
  );

  runCli(["write", dir, "--file", navrh(dir, r), "--reason", "x", "--apply"]);
  const zmeneny = {
    ...r,
    truth: "Napadame.",
    updated: "2026-09-02",
    timeline: [...r.timeline, { date: "2026-09-02", text: "obrat" }],
  };
  assert.match(
    runCli(["write", dir, "--file", navrh(dir, zmeneny), "--reason", "obrat"]).out,
    /^Zmena záznamu D-001/m,
  );
});
