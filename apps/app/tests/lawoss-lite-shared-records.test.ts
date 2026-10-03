// Review PR #100: sdílené záznamy podle souboru (ne ID) a klient podle složky z čtení paměti.
import { describe, expect, test } from "bun:test";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { LAYER_OF } from "../../../lawoss/okf-pamat/src/schema.ts";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { buildToday, groupByClient } from "../src/lawoss/lite/today-model";

const TODAY = "2026-09-24";
const rec = (id: string, type: "task" | "question", extra: Partial<OkfRecord> = {}): OkfRecord => ({
  okf: 1, id, type, title: `${type} ${id}`, description: "syntetický záznam", layer: LAYER_OF[type],
  jurisdiction: "cz", status: "active", created: TODAY, updated: TODAY, truth: "", timeline: [], ...extra,
});

describe("11: totožnost sdíleného záznamu = jeho soubor", () => {
  test("stejné ID ve dvou věcech (dva soubory) jsou dva úkoly", () => {
    const inputs: MatterInput[] = [
      { path: "AK/N/Novák/Spisy/A", records: [rec("T-001", "task")], recordFiles: { "T-001": "AK/N/Novák/Spisy/A/memory/T-001.md" } },
      { path: "AK/S/Svoboda/Spisy/B", records: [rec("T-001", "task")], recordFiles: { "T-001": "AK/S/Svoboda/Spisy/B/memory/T-001.md" } },
    ];
    const overview = buildOverview(inputs, TODAY);
    expect(overview.totals.openTasks).toBe(2);
    expect(buildToday({ ...overview, inputs }, TODAY).tasks).toHaveLength(2);
  });
  test("lhůta ze sdíleného souboru (kancelář) je na Dnes jednou se všemi věcmi", () => {
    const shared = rec("Q-100", "question", { deadlines: ["2026-09-30"] });
    const file = { "Q-100": "Office/memory/Q-100.md" };
    const inputs: MatterInput[] = ["A", "B", "C"].map((m) => ({ path: `AK/K/Klient/Spisy/${m}`, records: [shared], recordFiles: file }));
    const overview = buildOverview(inputs, TODAY);
    const rows = buildToday({ ...overview, inputs }, TODAY).deadlines.filter((d) => d.recordId === "Q-100");
    expect(rows).toHaveLength(1);
    expect([rows[0]!.matter, ...(rows[0]!.alsoIn ?? [])].map((m) => m.path)).toEqual(["AK/K/Klient/Spisy/A", "AK/K/Klient/Spisy/B", "AK/K/Klient/Spisy/C"]);
  });
});

describe("15: klient podle složky nalezené při čtení paměti", () => {
  test("rozvržení Klienti/<klient>/Spisy/… se seskupí podle klienta", () => {
    const inputs: MatterInput[] = [
      { path: "Klienti/Novák Jan/Spisy/Odvolání", records: [], scopePaths: ["Klienti/Novák Jan/Spisy/Odvolání", "Klienti/Novák Jan", "Office"] },
      { path: "Klienti/Novák Jan/Spisy/Pracovní", records: [], scopePaths: ["Klienti/Novák Jan/Spisy/Pracovní", "Klienti/Novák Jan", "Office"] },
      { path: "Interní/Projekt", records: [], scopePaths: ["Interní/Projekt", "Office"] },
    ];
    const overview = buildOverview(inputs, TODAY);
    expect(groupByClient(overview.matters, inputs).map((g) => [g.client, g.matters.length])).toEqual([["Novák Jan", 2], ["Projekt", 1]]);
  });
  test("bez scopePaths platí tvar AK/<písmeno>/<klient>", () => {
    const inputs: MatterInput[] = [{ path: "AK/N/Novák Jan/Spisy/A", records: [] }, { path: "AK/N/Novák Jan/Spisy/B", records: [] }];
    expect(groupByClient(buildOverview(inputs, TODAY).matters).map((g) => [g.client, g.matters.length])).toEqual([["Novák Jan", 2]]);
  });
});
