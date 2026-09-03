/**
 * Prechod medzi Obsidianom a nástrojom, oboma smermi.
 *
 * Tri veci, ktoré sa našli až skúšaním na napodobenine skutočného vaultu.
 * Každá z nich vyzerala v kóde v poriadku a každá tichým spôsobom nefungovala.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { parseRecord, serializeRecord } from "../src/record.ts";
import { newRecord, validateStore, truthDigest, MEMORY_DIR } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const DNES = { today: "2026-09-02" };

function spis(): string {
  const dir = mkdtempSync(join(tmpdir(), "okf-prechod-"));
  mkdirSync(join(dir, MEMORY_DIR));
  writeFileSync(join(dir, "_STATUS.md"), "# Status\n");
  return dir;
}

function subjekt(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "S-001", type: "subject", jurisdiction: "cz",
      title: "Eva Nováková", description: "klientka",
      created: "2026-09-02", updated: "2026-09-02",
      truth: "Klientka, predávajúca vozidlo.",
      timeline: [{ date: "2026-09-02", text: "založené" }],
      role: "client", person_type: "natural_person",
      deadlines: ["2026-10-01"],
    }),
    ...over,
  };
}

function zapis(dir: string, r: OkfRecord): void {
  const navrh = join(dir, "navrh.md");
  writeFileSync(navrh, serializeRecord(r));
  const res = runCli(["write", dir, "--file", navrh, "--reason", "x", "--apply"]);
  assert.equal(res.code, 0, res.out);
}

const suborZaznamu = (dir: string, id: string) =>
  readdirSync(join(dir, MEMORY_DIR)).find((f) => f.startsWith(`${id}-`));

// --- Obsidian → nástroj: cudzie kľúče vo frontmatteri ---------------------

test("Obsidian tagy su prvotriedne pole, cudzie kluce prezijú v extra", () => {
  // Advokát v Obsidiane pridá tagy. Kým bol neznámy kľúč chybou, celý záznam
  // vypadol zo store — a s ním z jehiel detektora únikov. Tichý dôsledok
  // pridania tagu teda nebolo nepohodlie, ale slepá brána.
  //
  // `tags` je odporúčané pole OKF, takže patrí do schémy. `cssclasses` je
  // čisto obsidianovské a zostáva cudzím kľúčom — musí prežiť round-trip.
  const r = parseRecord(serializeRecord(subjekt()).replace(
    "role: client", "role: client\ntags: [klient, vozidlo]\ncssclasses: pravni"));
  assert.deepEqual(r.tags, ["klient", "vozidlo"], "tags je pole schémy, nie cudzí kľúč");
  assert.deepEqual(r.extra, { cssclasses: "pravni" });
  assert.equal(r.role, "client", "známe polia sa čítajú ďalej");

  const spat = parseRecord(serializeRecord(r));
  assert.deepEqual(spat.tags, r.tags);
  assert.deepEqual(spat.extra, r.extra, "round-trip nesmie nič stratiť");
});

test("cudzi kluc sa zapise spat do suboru, nie zahodi", () => {
  const dir = spis();
  const s = serializeRecord(subjekt()).replace("role: client", "role: client\ntags: [vozidlo]");
  writeFileSync(join(dir, MEMORY_DIR, "S-001-x.md"), s);
  runCli(["sync", dir, "--apply"]);
  const subor = suborZaznamu(dir, "S-001");
  assert.ok(subor);
  assert.match(readFileSync(join(dir, MEMORY_DIR, subor), "utf8"), /tags:/);
});

// --- nástroj → Obsidian: odkazy musia niekam viesť ------------------------

test("odkaz v _STATUS.md mieri na skutocny subor, nie na [[ID]]", () => {
  // `[[S-001]]` sa v Obsidiane hľadá podľa názvu súboru, ale súbor sa volá
  // `S-001-eva-novakova.md` — odkaz teda nikdy nesadol.
  const dir = spis();
  zapis(dir, subjekt());
  runCli(["sync", dir, "--apply"]);
  const status = readFileSync(join(dir, "_STATUS.md"), "utf8");

  assert.doesNotMatch(status, /\[\[S-001\]\]/, "wiki-odkaz na holé ID je osirelý");
  const m = /\[S-001\]\(\.\/(memory\/[^)]+)\)/.exec(status);
  assert.ok(m, `odkaz sa nenašiel v:\n${status}`);
  assert.ok(suborZaznamu(dir, "S-001"), "cieľový súbor musí existovať");
  assert.equal(m[1], `${MEMORY_DIR}/${suborZaznamu(dir, "S-001")}`);
});

test("odkaz v index.md je relativny voci memory/, nie voci spisu", () => {
  const dir = spis();
  zapis(dir, subjekt());
  runCli(["sync", dir, "--apply"]);
  const index = readFileSync(join(dir, MEMORY_DIR, "index.md"), "utf8");
  assert.match(index, /\[S-001\]\(\.\/S-001-[^)]+\.md\)/);
  assert.doesNotMatch(index, /\.\/memory\//, "z memory/ sa na memory/ neodkazuje");
});

test("bez znameho suboru sa vypise holé ID, nie rozbity odkaz", () => {
  const dir = spis();
  const status = runCli(["sync", dir]).out;
  assert.doesNotMatch(status, /\]\(\)/, "prázdny cieľ odkazu je horší než žiadny odkaz");
});

// --- Obsidian → nástroj: ručná zmena Pravdy ------------------------------

test("rucna zmena Pravdy v Obsidiane sa odhali", () => {
  // Brána atomicity beží v ceste zápisu. Úprava v Obsidiane cez ňu nejde,
  // takže bez odtlačku by zmena Pravdy bez riadku Histórie prešla bez stopy.
  const dir = spis();
  zapis(dir, subjekt());
  const subor = suborZaznamu(dir, "S-001");
  assert.ok(subor);
  const path = join(dir, MEMORY_DIR, subor);

  const ulozeny = parseRecord(readFileSync(path, "utf8"));
  assert.ok(ulozeny.truth_digest, "zápis musí odtlačok uložiť");
  assert.deepEqual(validateStore([ulozeny], DNES).filter((f) => f.code === "TRUTH_EDITED_OUTSIDE"), []);

  writeFileSync(path, readFileSync(path, "utf8").replace(
    "Klientka, predávajúca vozidlo.", "Klientka od zmluvy odstúpila."));
  const f = validateStore([parseRecord(readFileSync(path, "utf8"))], DNES)
    .find((x) => x.code === "TRUTH_EDITED_OUTSIDE");
  assert.ok(f, "zmena Pravdy mimo nástroja musí byť nález");
  assert.equal(f.severity, "warning", "úprava rukou je legitímna, chýba jej len stopa");
});

test("zaznam bez odtlacku sa nekontroluje — staré spisy musia ďalej fungovať", () => {
  const bez = subjekt();
  delete bez.truth_digest;
  assert.deepEqual(
    validateStore([bez], DNES).filter((f) => f.code === "TRUTH_EDITED_OUTSIDE"), []);
});

test("odtlacok si nevsima biele znaky na okrajoch", () => {
  assert.equal(truthDigest("text"), truthDigest("  text\n"));
  assert.notEqual(truthDigest("text"), truthDigest("iný text"));
});

// --- Dropbox ---------------------------------------------------------------

test("konfliktna kopia z Dropboxu sa ohlasi ako duplicita", () => {
  const dir = spis();
  zapis(dir, subjekt());
  const subor = suborZaznamu(dir, "S-001");
  assert.ok(subor);
  const obsah = readFileSync(join(dir, MEMORY_DIR, subor), "utf8");
  writeFileSync(join(dir, MEMORY_DIR, "S-001-x (Vojtech's conflicted copy 2026-09-02).md"), obsah);

  const r = runCli(["validate", dir]);
  assert.match(r.out, /DUPLICATE_ID/);
  assert.equal(r.code, 1, "dve pravdy o tom istom zázname sú chyba, nie varovanie");
});
