/**
 * Napojenie na existujúci Obsidian vault advokáta.
 *
 * Vault, ktorý vznikol pred OKF, má klientov usporiadaných podľa vlastnej
 * logiky a karty `klient.md` v ňom nie sú. Bez rozpoznania klientskej úrovne
 * by AML subjekty vypadli z `readScope` — a s nimi **aj z dosahu brány úniku**.
 * Testy držia hlavne to.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newRecord, readScope, findClientDir, matchesClientPath, planWrite, applyRecordWrite,
  MEMORY_DIR, OFFICE_DIR, CONFIG_FILE, LeakBlockedError,
} from "../src/index.ts";
import { serializeRecord } from "../src/record.ts";

const KONFIG = "client_path: AK/*/*\n";

/** Napodobenina vaultu: koreň → AK/{písmeno}/{klient}/{vec}. Žiadna karta. */
function vault(config = KONFIG): { root: string; klient: string; spis: string } {
  const root = mkdtempSync(join(tmpdir(), "okf-vault-"));
  mkdirSync(join(root, OFFICE_DIR, MEMORY_DIR), { recursive: true });
  writeFileSync(join(root, OFFICE_DIR, CONFIG_FILE), config);
  const klient = join(root, "AK", "R", "Říhová Veronika");
  const spis = join(klient, "Prodej vozidla");
  mkdirSync(join(spis, MEMORY_DIR), { recursive: true });
  mkdirSync(join(klient, MEMORY_DIR), { recursive: true });
  return { root, klient, spis };
}

function subjekt(id: string, over: Record<string, string> = {}) {
  return newRecord({
    id, type: "subject", jurisdiction: "cz",
    title: "Veronika Říhová", description: "klientka",
    created: "2026-09-02", updated: "2026-09-02", truth: "t",
    timeline: [{ date: "2026-09-02", text: "založené" }],
    role: "client", person_type: "natural", ...over,
  });
}

// --- vzor cesty ------------------------------------------------------------

test("hviezdicka zastupuje prave jeden segment", () => {
  assert.ok(matchesClientPath("AK/R/Novák Jan", "AK/*/*"));
  assert.ok(!matchesClientPath("AK/R/Novák Jan/Vec", "AK/*/*"),
    "priečinok veci nesmie prejsť ako klient");
  assert.ok(!matchesClientPath("AK/R", "AK/*/*"));
  assert.ok(!matchesClientPath("Iné/R/Novák", "AK/*/*"));
});

test("doslovny segment vo vzore musi sediet", () => {
  assert.ok(matchesClientPath("AK/R/X", "AK/R/*"));
  assert.ok(!matchesClientPath("AK/S/X", "AK/R/*"));
});

// --- rozpoznanie klienta ---------------------------------------------------

test("bez konfigu sa klient vo vaulte nenajde", () => {
  const { spis } = vault("");
  assert.equal(findClientDir(spis), undefined,
    "prázdny konfig nesmie nič uhádnuť");
});

test("s client_path sa klient najde aj bez karty", () => {
  const { klient, spis } = vault();
  assert.equal(findClientDir(spis), klient);
});

test("karta v priecinku prebije vzor", () => {
  const { root, spis } = vault();
  // Vec dostane vlastnú kartu → je to klient sám pre seba, konkrétnejšie ako vzor.
  const vnorenaVec = join(spis, "Podspis");
  mkdirSync(join(vnorenaVec, MEMORY_DIR), { recursive: true });
  writeFileSync(join(spis, "klient.md"), "---\ntype: klient\n---\n");
  assert.equal(findClientDir(vnorenaVec), spis);
  assert.ok(root);
});

// --- dôsledok pre readScope a pre bránu úniku ------------------------------

test("subjekt u klienta je vo scope spisu", () => {
  const { klient, spis } = vault();
  writeFileSync(join(klient, MEMORY_DIR, "S-001-x.md"), serializeRecord(subjekt("S-001")));
  const scope = readScope(spis);
  assert.equal(scope.clientDir, klient);
  assert.equal(scope.clientRecords.length, 1);
});

test("brana uniku vidi klientske identifikatory aj vo vaulte", () => {
  // Toto je dôvod, prečo rozpoznanie klienta nie je pohodlie, ale bezpečnosť:
  // keby klientská úroveň nevznikla, prameň s IČO klienta by prešiel na disk.
  const { klient, spis } = vault();
  writeFileSync(
    join(klient, MEMORY_DIR, "S-001-x.md"),
    serializeRecord(subjekt("S-001", { registry_id: "29139643" })),
  );
  const pramen = newRecord({
    id: "A-001", type: "authority", jurisdiction: "cz",
    title: "Právna veta", description: "prameň",
    created: "2026-09-02", updated: "2026-09-02",
    truth: "Vec spoločnosti s IČO 29139643.",
    timeline: [{ date: "2026-09-02", text: "z" }],
  });
  assert.throws(
    () => applyRecordWrite(spis, planWrite(undefined, pramen, "veta"), {
      by: "JUDr. Vojtěch Říha", at: "2026-09-02T10:00:00Z",
    }),
    LeakBlockedError,
  );
});

test("bez client_path by tá istá brána bola slepá — regresný dôkaz", () => {
  const { klient, spis } = vault("");
  writeFileSync(
    join(klient, MEMORY_DIR, "S-001-x.md"),
    serializeRecord(subjekt("S-001", { registry_id: "29139643" })),
  );
  const pramen = newRecord({
    id: "A-002", type: "authority", jurisdiction: "cz",
    title: "Veta", description: "p", created: "2026-09-02", updated: "2026-09-02",
    truth: "Vec spoločnosti s IČO 29139643.",
    timeline: [{ date: "2026-09-02", text: "z" }],
  });
  // Prejde — a presne preto sa client_path musí nastaviť pri napojení vaultu.
  assert.doesNotThrow(() =>
    applyRecordWrite(spis, planWrite(undefined, pramen, "veta"), {
      by: "JUDr. Vojtěch Říha", at: "2026-09-02T10:00:00Z",
    }));
});

// --- diakritika v názvoch priečinkov --------------------------------------

test("cesta s ceskou diakritikou sa rozpozna", () => {
  // macOS ukladá názvy v NFD, reťazec v teste je NFC. Porovnanie ciest ide
  // cez `relative()` nad tým istým zdrojom, takže obe strany sedia — tento
  // test to drží, aby to tak zostalo.
  const { klient, spis } = vault();
  assert.equal(findClientDir(spis), klient);
  assert.match(klient, /Říhová/);
});
