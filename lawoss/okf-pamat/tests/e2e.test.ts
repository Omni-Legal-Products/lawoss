import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEMORY_DIR, readStore, ensureBrain, writeIndex, syncStatus,
  applyRecordWrite, planWrite, validateStore, newRecord,
  ApprovalRequiredError, TimelineIntegrityError, LeakBlockedError,
} from "../src/index.ts";
import type { Jurisdiction } from "../src/index.ts";

const ADVOKAT = { by: "JUDr. Vojtěch Říha, Ph.D.", at: "2026-08-29T12:00:00Z" };

function zalozSpis(j: Jurisdiction): string {
  const dir = mkdtempSync(join(tmpdir(), `okf-e2e-${j}-`));
  mkdirSync(join(dir, MEMORY_DIR));
  writeFileSync(
    join(dir, "_STATUS.md"),
    ["# Novák ⁄ Svoboda — Status (SSOT)", "", "> **Fáze:** příprava žaloby",
     "> **Další krok:** doplnit plnou moc", "", "## 9. Moje poznámky", "Sem mi nikdo nesahá.", ""].join("\n"),
  );
  ensureBrain(dir, j);
  return dir;
}

for (const j of ["cz", "sk"] as const) {
  test(`[${j}] cely tok: zalozenie, zapis, brana, projekcia, validacia`, () => {
    const dir = zalozSpis(j);

    // 1. Agent sam zapise subjekt a rozhodnutie do L2.
    const subjekt = newRecord({
      id: "S-001", type: "subject", jurisdiction: j,
      title: "Stavby Modrý Kámen s.r.o.", description: "protistrana, overena v registri",
      registry_id: "12345678", created: "2026-08-29", updated: "2026-08-29",
      truth: "Protistrana, zapisana v registri.",
      timeline: [{ date: "2026-08-29", text: "overene v obchodnom registri" }],
    });
    applyRecordWrite(dir, planWrite(undefined, subjekt, "zalozenie subjektu"), undefined);

    const rozhodnutie = newRecord({
      id: "R-001", type: "decision", jurisdiction: j,
      title: "Nepodavat namietku prislusnosti", description: "zdrzanie prevazuje nad vyhodou",
      created: "2026-08-29", updated: "2026-08-29",
      deadlines: ["2026-09-12"], related: ["S-001"],
      truth: "Miestnu prislusnost nenapadame.",
      timeline: [{ date: "2026-08-29", text: "rozhodnute po porade s klientom" }],
    });
    applyRecordWrite(dir, planWrite(undefined, rozhodnutie, "takticke rozhodnutie"), undefined);
    assert.equal(readStore(dir).records.length, 2);

    // 2. Zmena pravdy bez stopy v historii neprejde.
    assert.throws(
      () => planWrite(rozhodnutie, { ...rozhodnutie, truth: "uplne inak" }, "obrat"),
      TimelineIntegrityError,
    );

    // 3. So stopou prejde.
    const obrat = {
      ...rozhodnutie,
      truth: "Prislusnost napadame — objavil sa novy dovod.",
      updated: "2026-08-30",
      timeline: [...rozhodnutie.timeline, { date: "2026-08-30", text: "novy dovod: sidlo protistrany" }],
    };
    applyRecordWrite(dir, planWrite(rozhodnutie, obrat, "nove zistenie"), undefined);

    // 4. Povysenie do L1 agent sam nesmie.
    const poucenie = newRecord({
      id: "P-001", type: "lesson", jurisdiction: j,
      title: "Prislusnost overovat pred podanim", description: "poucenie do praxe kancelarie",
      created: "2026-08-30", updated: "2026-08-30",
      truth: "Sidlo protistrany overit z registra pred podanim, nie po nom.",
      timeline: [{ date: "2026-08-30", text: "vzniklo z veci Novak" }],
    });
    const navrh = planWrite(undefined, poucenie, "povysenie poznatku do L1");
    assert.equal(navrh.requiresApproval, true);
    assert.throws(() => applyRecordWrite(dir, navrh, undefined), ApprovalRequiredError);
    assert.equal(readStore(dir).records.length, 2, "odmietnuty zapis nesmie nic vytvorit");

    // 5. So schvalenim advokata prejde.
    applyRecordWrite(dir, navrh, ADVOKAT);
    assert.equal(readStore(dir).records.length, 3);

    // 6. Klientsky udaj sa do zdielatelnej pravnej vrstvy nedostane —
    //    brana ho zastavi uz pri zapise, nie az pri samostatnej validacii.
    const spinavy = newRecord({
      id: "J-001", type: "authority", jurisdiction: j, verified_at: "2026-09-02",
      title: "K miestnej prislusnosti", description: "pravny pramen",
      created: "2026-08-30", updated: "2026-08-30",
      truth: "Vec sa tykala spolocnosti s ICO 12345678.",
      timeline: [{ date: "2026-08-30", text: "zalozene" }],
    });
    assert.throws(
      () => applyRecordWrite(dir, planWrite(undefined, spinavy, "pravna veta"), ADVOKAT),
      LeakBlockedError,
    );
    assert.equal(readStore(dir).records.length, 3, "odmietnuty zapis nesmie nic vytvorit");

    // 7. Cisty pramen prejde a pamat je validna.
    const cisty = {
      ...spinavy,
      truth: "Miestna prislusnost sa posudzuje k okamihu zacatia konania.",
    };
    applyRecordWrite(dir, planWrite(undefined, cisty, "pravna veta"), ADVOKAT);
    assert.equal(readStore(dir).records.length, 4);
    assert.deepEqual(validateStore(readStore(dir).records), []);

    // 8. Projekcia: bloky sa naplnia, ludsky text zostane, druhy beh nic nezmeni.
    writeIndex(dir);
    syncStatus(dir);
    const status = readFileSync(join(dir, "_STATUS.md"), "utf8");
    assert.match(status, /2026-09-12/, "lehota sa nepremietla");
    assert.match(status, /> \*\*Fáze:\*\* příprava žaloby/, "ludska hlavicka sa stratila");
    assert.match(status, /Sem mi nikdo nesahá\./, "ludska sekcia sa stratila");
    syncStatus(dir);
    assert.equal(readFileSync(join(dir, "_STATUS.md"), "utf8"), status, "render nie je idempotentny");

    const index = readFileSync(join(dir, MEMORY_DIR, "index.md"), "utf8");
    for (const id of ["S-001", "R-001", "P-001", "J-001"]) assert.match(index, new RegExp(id));
  });
}

test("mazanie zaznamu vyzaduje cloveka aj v L2", () => {
  const dir = zalozSpis("cz");
  const r = newRecord({
    id: "R-009", type: "decision", jurisdiction: "cz", title: "Docasne", description: "s",
    created: "2026-08-29", updated: "2026-08-29", truth: "t", timeline: [],
  });
  applyRecordWrite(dir, planWrite(undefined, r, "zalozenie"), undefined);
  const zmazanie = planWrite(r, undefined, "duplicita");
  assert.throws(() => applyRecordWrite(dir, zmazanie, undefined), ApprovalRequiredError);
  assert.equal(readStore(dir).records.length, 1);
  applyRecordWrite(dir, zmazanie, ADVOKAT);
  assert.equal(readStore(dir).records.length, 0);
});
