import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRecordWrite, memoryDirName, LeakBlockedError } from "../src/store.ts";
import { serializeRecord } from "../src/record.ts";
import { newRecord, planWrite } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const SCHVALENIE = { by: "JUDr. Vojtěch Říha", at: "2026-09-01T10:00:00Z" };

function subjekt(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "S-001", type: "subject", jurisdiction: "cz",
      title: "Gh Real Estate s.r.o.", summary: "protistrana",
      created: "2026-09-01", updated: "2026-09-01", truth: "t",
      timeline: [{ date: "2026-09-01", text: "overené" }],
      registry_id: "29139643",
    }),
    ...over,
  };
}

function spisSoSubjektom(s: OkfRecord = subjekt()): string {
  const dir = mkdtempSync(join(tmpdir(), "okf-leak-"));
  mkdirSync(join(dir, memoryDirName("cz")));
  writeFileSync(join(dir, "pamet", `${s.id}-x.md`), serializeRecord(s));
  return dir;
}

function pramen(id: string, truth: string): OkfRecord {
  return newRecord({
    id, type: "authority", jurisdiction: "cz",
    title: "Právna veta", summary: "prameň",
    created: "2026-09-01", updated: "2026-09-01", truth,
    timeline: [{ date: "2026-09-01", text: "založené" }],
  });
}

const pocet = (dir: string) => readdirSync(join(dir, "pamet")).length;

test("zapis pramena s ICO klienta sa odmietne uz pri zapise", () => {
  const dir = spisSoSubjektom();
  const p = pramen("A-001", "Vec sa týkala spoločnosti s IČO 29139643.");
  assert.throws(
    () => applyRecordWrite(dir, planWrite(undefined, p, "právna veta"), SCHVALENIE),
    LeakBlockedError,
  );
  assert.equal(pocet(dir), 1, "na disku nesmie nič pribudnúť");
});

test("chyba pomenuje zaznam aj dovod", () => {
  const dir = spisSoSubjektom();
  const p = pramen("A-002", "IČO 29139643 figuruje vo veci.");
  try {
    applyRecordWrite(dir, planWrite(undefined, p, "x"), SCHVALENIE);
    assert.fail("malo vyhodiť výnimku");
  } catch (e) {
    assert.ok(e instanceof LeakBlockedError);
    assert.match((e as Error).message, /A-002/);
    assert.match((e as Error).message, /29139643/);
  }
});

test("cisty pramen prejde", () => {
  const dir = spisSoSubjektom();
  const p = pramen("A-003", "Miestna príslušnosť sa posudzuje k okamihu začatia konania.");
  applyRecordWrite(dir, planWrite(undefined, p, "právna veta"), SCHVALENIE);
  assert.equal(pocet(dir), 2);
});

test("varovanie zapis neblokuje — kratke meno je na posudenie, nie na zakaz", () => {
  const dir = spisSoSubjektom(subjekt({ title: "Novák", registry_id: "" }));
  const p = pramen("A-004", "Žalobca Novák namietal premlčanie.");
  assert.doesNotThrow(() =>
    applyRecordWrite(dir, planWrite(undefined, p, "veta"), SCHVALENIE));
  assert.equal(pocet(dir), 2);
});

test("zapis do L2 sa kontrolou uniku nezdrzuje", () => {
  const dir = spisSoSubjektom();
  const r = newRecord({
    id: "D-001", type: "decision", jurisdiction: "cz",
    title: "Rozhodnutie", summary: "IČO overené v OR",
    created: "2026-09-01", updated: "2026-09-01", truth: "IČO 29139643 sedí.",
    timeline: [{ date: "2026-09-01", text: "z" }],
  });
  assert.doesNotThrow(() =>
    applyRecordWrite(dir, planWrite(undefined, r, "fakt"), undefined));
});

test("uprava existujuceho pramena, ktora unik zavedie, sa tiez odmietne", () => {
  const dir = spisSoSubjektom();
  const cisty = pramen("A-005", "Miestna príslušnosť sa posudzuje k začiatku konania.");
  applyRecordWrite(dir, planWrite(undefined, cisty, "veta"), SCHVALENIE);

  const spinavy = {
    ...cisty,
    truth: "Vec spoločnosti s IČO 29139643.",
    updated: "2026-09-02",
    timeline: [...cisty.timeline, { date: "2026-09-02", text: "doplnené" }],
  };
  assert.throws(
    () => applyRecordWrite(dir, planWrite(cisty, spinavy, "doplnenie"), SCHVALENIE),
    LeakBlockedError,
  );
});

test("subjekt na klientskej urovni bran nemoze uniknut", () => {
  // AML subjekty žijú u klienta, prameň sa zapisuje v spise. Keby brána
  // čítala iba spis, klientske identifikátory by nevidela — teda presne tie,
  // kvôli ktorým existuje.
  const root = mkdtempSync(join(tmpdir(), "okf-scope-leak-"));
  const klient = join(root, "Gh Real Estate");
  const spis = join(klient, "3 - Soudni", "2026-09 vec");
  mkdirSync(spis, { recursive: true });
  writeFileSync(join(klient, "klient.md"), "---\ntype: klient\n---\n");
  mkdirSync(join(klient, memoryDirName("cz")));
  mkdirSync(join(spis, memoryDirName("cz")));
  writeFileSync(join(klient, "pamet", "S-001-x.md"), serializeRecord(subjekt()));

  const p = pramen("A-006", "Vo veci spoločnosti s IČO 29139643.");
  assert.throws(
    () => applyRecordWrite(spis, planWrite(undefined, p, "veta"), SCHVALENIE),
    LeakBlockedError,
  );
  assert.equal(readdirSync(join(spis, "pamet")).length, 0, "v spise nesmie nič pribudnúť");
});

test("mazanie pramena kontrolu uniku nespusti", () => {
  const dir = spisSoSubjektom();
  const p = pramen("A-007", "Čistá právna veta.");
  applyRecordWrite(dir, planWrite(undefined, p, "veta"), SCHVALENIE);
  assert.doesNotThrow(() =>
    applyRecordWrite(dir, planWrite(p, undefined, "duplicita"), SCHVALENIE));
  assert.equal(pocet(dir), 1);
});
