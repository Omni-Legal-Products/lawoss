import { describe, expect, test } from "bun:test";

import { LAYER_OF, type RecordType } from "../../../lawoss/okf-pamat/src/schema.ts";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { buildCockpit, clientFromPath, provenance, REGISTER_ORDER, type CockpitInput } from "../../../lawoss/okf/cockpit";

const TODAY = "2026-09-12";
const PATH = "AK/N/Novák Jan/Spisy/MSPH 79 INS 1-2026";

function rec(type: RecordType, id: string, extra: Partial<OkfRecord> = {}): OkfRecord {
  return {
    okf: 1, id, type, title: `${type} ${id}`, description: "syntetický záznam", layer: LAYER_OF[type],
    jurisdiction: "cz", status: "active", created: TODAY, updated: TODAY, truth: "", timeline: [], ...extra,
  };
}

/** Vstup cockpitu poskladaný tak, ako ho vracia read-model: prehľad + záznamy + problémy. */
function input(matters: MatterInput[], problems: { path: string; message: string }[] = []): CockpitInput {
  return { ...buildOverview(matters, TODAY), inputs: matters, problems };
}

const matter = (records: OkfRecord[], recordFiles?: Record<string, string>): MatterInput => ({
  path: PATH,
  cardFrontmatter: { title: "Novák Jan — insolvence", spisova_znacka: "MSPH 79 INS 1/2026", sud: "Městský soud v Praze", status: "aktivní" },
  records,
  ...(recordFiles ? { recordFiles } : {}),
});

describe("buildCockpit — výber veci a poradie registrov", () => {
  test("neexistujúca vec vráti null, prázdny workspace tiež", () => {
    const data = input([matter([rec("matter", "M-001")])]);
    expect(buildCockpit(data, "AK/X/Nikto/Spisy/niet", TODAY)).toBeNull();
    expect(buildCockpit({ matters: [], inputs: [], problems: [] }, null, TODAY)).toBeNull();
    // bez parametra sa otvorí prvá vec v prehľade
    expect(buildCockpit(data, null, TODAY)?.matter.path).toBe(PATH);
  });

  test("registre majú pevné poradie OBAL → FAKTY → ÚLOHY → LEHOTY a hlavičku z karty", () => {
    const c = buildCockpit(
      input([matter([
        rec("matter", "M-001"),
        rec("evidence", "E-001", { sources: [{ title: "Usnesení o úpadku", resource: "ISIR A-24, s. 3" }], origin_date: "2026-08-01" }),
        rec("task", "T-001", { state: "open", assignee: "VR", due: "2026-09-30" }),
      ])]),
      PATH,
      TODAY,
    );
    if (!c) throw new Error("cockpit chýba");
    expect(c.registers.map((r) => r.id)).toEqual([...REGISTER_ORDER]);
    expect(c.matter.matterRef).toBe("MSPH 79 INS 1/2026");
    expect(c.client).toBe("Novák Jan");
    expect(c.jurisdiction).toBe("cz");
    expect(c.obal.map((f) => f.missing)).toEqual([false, false, false, false]);
    expect(c.facts).toHaveLength(1);
    expect(c.facts[0]).toMatchObject({ id: "E-001", source: "Usnesení o úpadku", locator: "ISIR A-24, s. 3", date: "2026-08-01", provenance: "zapísané" });
    expect(c.tasks).toEqual([{ id: "T-001", title: "task T-001", overdue: false, file: `${PATH}/memory/`, assignee: "VR", due: "2026-09-30" }]);
    expect(c.okfValid).toBe(true);
  });
});

describe("buildCockpit — čaká na pozornosť advokáta", () => {
  test("vec s uplynulou lehotou ju dá na prvé miesto a označí slovom", () => {
    const c = buildCockpit(
      input([matter(
        [
          rec("evidence", "E-001", { title: "Odvolanie", deadlines: ["2026-09-01"], sources: [{ title: "Rozsudok" }] }),
          rec("evidence", "E-002", { title: "Vyjadrenie", deadlines: ["2026-09-15"], sources: [{ title: "Výzva súdu" }], extra: { generated: { by: "agent", at: TODAY } } }),
          rec("evidence", "E-003", { title: "Ďaleká lehota", deadlines: ["2026-12-01"], sources: [{ title: "Zmluva" }] }),
        ],
        { "E-001": `${PATH}/memory/E-001-odvolanie.md` },
      )]),
      PATH,
      TODAY,
    );
    if (!c) throw new Error("cockpit chýba");
    expect(c.attention[0]).toMatchObject({ kind: "lehota", state: "po termíne", title: "Odvolanie", date: "2026-09-01", file: `${PATH}/memory/E-001-odvolanie.md` });
    expect(c.attention[1]).toMatchObject({ state: "blíži sa", date: "2026-09-15", provenance: "AI návrh" });
    // lehota ďalej než 7 dní na advokáta nečaká, v registri však ostáva
    expect(c.attention.some((r) => r.title === "Ďaleká lehota")).toBe(false);
    expect(c.deadlines.confirmed.map((d) => d.date)).toEqual([]);
    expect(c.deadlines.candidates.map((d) => d.date)).toEqual(["2026-09-01", "2026-09-15", "2026-12-01"]);
    expect(c.registers.find((r) => r.id === "lehoty")?.count).toBe(3);
  });

  test("vec bez lehôt nemá lehotový riadok ani kandidáta, ale nálezy hlási", () => {
    const c = buildCockpit(
      input([{ path: PATH, records: [rec("task", "T-001", { state: "open" })] }]),
      PATH,
      TODAY,
    );
    if (!c) throw new Error("cockpit chýba");
    expect(c.deadlines).toEqual({ confirmed: [], candidates: [] });
    expect(c.attention.some((r) => r.kind === "lehota")).toBe(false);
    // bez karty spisu chýba značka aj súd — to je nález, nie ticho
    expect(c.attention.map((r) => r.title)).toEqual(["Obal: Spisová značka", "Obal: Súd / orgán"]);
    expect(c.attention.every((r) => r.state === "chýba údaj")).toBe(true);
    expect(c.okfValid).toBe(false);
  });

  test("neparsovateľný záznam nezmizne — je v attention aj v unreadable", () => {
    const broken = `${PATH}/memory/Z-999-rozbity.md`;
    const c = buildCockpit(
      input([matter([rec("matter", "M-001")])], [
        { path: broken, message: "Záznam nemá frontmatter — chýba úvodný oddeľovač ---" },
        { path: "AK/P/Iný/Spisy/vec/memory/X.md", message: "cudzia vec" },
      ]),
      PATH,
      TODAY,
    );
    if (!c) throw new Error("cockpit chýba");
    expect(c.unreadable).toEqual([{ path: broken, message: "Záznam nemá frontmatter — chýba úvodný oddeľovač ---" }]);
    const row = c.attention.find((r) => r.kind === "záznam");
    expect(row).toMatchObject({ state: "neparsovateľné", title: "Z-999-rozbity.md", file: broken });
    expect(c.okfValid).toBe(false);
  });
});

describe("pomocné funkcie", () => {
  test("provenance rozlišuje overené, AI návrh a zapísané", () => {
    expect(provenance(rec("claim", "C-1", { verified: [{ by: "VR", at: TODAY, type: "human", truth: "" }] }))).toBe("overené");
    expect(provenance(rec("claim", "C-2", { extra: { generated: { by: "agent", at: TODAY } } }))).toBe("AI návrh");
    expect(provenance(rec("claim", "C-3"))).toBe("zapísané");
  });

  test("klient sa číta z cesty AK/<písmeno>/<klient>/Spisy/<vec>", () => {
    expect(clientFromPath(PATH)).toBe("Novák Jan");
    expect(clientFromPath("Office/memory")).toBeUndefined();
  });
});

describe("audit alpha — potvrdenie a poradenská vec", () => {
  test("legacy a strojové overenie nepotvrdzujú žiadny termín", () => {
    const c = buildCockpit(input([matter([
      rec("question", "Q-001", { deadlines: ["2026-09-30"], verified: [{ by: "machine", at: TODAY }] }),
      rec("decision", "D-001", { deadlines: ["2026-10-01"] }),
    ])]), PATH, TODAY)!;
    expect(c.deadlines.confirmed).toHaveLength(0);
    expect(c.deadlines.candidates).toHaveLength(2);
    expect(provenance(rec("claim", "C-001", { verified: [{ by: "machine", at: TODAY }] }))).not.toBe("overené");
  });
  test("poradenstvo nevyžaduje súd ani procesnú značku", () => {
    const c = buildCockpit(input([{ path: PATH, cardFrontmatter: { matter_kind: "advisory", jurisdiction: "sk" }, records: [rec("matter", "M-001")] }]), PATH, TODAY)!;
    expect(c.attention.filter((r) => r.id.startsWith("nalez:obal:"))).toEqual([]);
    expect(c.okfValid).toBe(true);
  });
});

 test("human confirmation covers exactly one date and reviewed content", () => {
  const r = rec("decision", "D-003", { truth: "Doručené", deadlines: ["2026-09-30", "2026-10-01"], verified: [{ by: "VR", at: TODAY, type: "human", deadline: "2026-09-30", truth: "Doručené" }] });
  const c = buildCockpit(input([matter([r])]), PATH, TODAY)!;
  expect(c.deadlines.confirmed.map((d) => d.date)).toEqual(["2026-09-30"]);
  expect(c.deadlines.candidates.map((d) => d.date)).toEqual(["2026-10-01"]);
  expect(buildCockpit(input([matter([{ ...r, truth: "Opravené doručenie" }])]), PATH, TODAY)!.deadlines.confirmed).toHaveLength(0);
 });

test("pending intake rows remain visible despite generic narrative mentioning processed", () => {
  const m = matter([rec("matter", "M-001")]);
  m.intake = "Use pending / processed.\n| ID | Prijaté | Zdroj | Originál | Stav | Výsledné záznamy |\n| --- | --- | --- | --- | --- | --- |\n| IN-001 | 2026-09-12 | email | mail.eml | pending | |\n| IN-002 | 2026-09-11 | email | old.eml | processed | Q-001 |";
  const c = buildCockpit(input([m]), PATH, TODAY)!;
  expect(c.attention.filter((r) => r.state === "nespracované").map((r) => r.id)).toEqual(["vstup:IN-001"]);
});

for (const shared of ["Office", "AK/N/Novák Jan"]) {
  test(`failed shared memory directory listing stays visible: ${shared}`, () => {
    const m = { ...matter([rec("matter", "M-001")]), scopePaths: [PATH, "AK/N/Novák Jan", "Office"] };
    const problem = { path: `${shared}/memory`, message: "EACCES" };
    const c = buildCockpit(input([m], [problem]), PATH, TODAY)!;
    expect(c.unreadable).toEqual([problem]);
    expect(c.okfValid).toBe(false);
  });
}

for (const at of ["2026-99-99", "2026-02-30", "2026-09-12Tgarbage", "2026-09-12T25:00:00Z"]) {
  test(`invalid verification timestamp cannot confirm a deadline: ${at}`, () => {
    const r = rec("question", "Q-INVALID", { deadlines: ["2026-10-01"], verified: [{ by: "VR", at, type: "human", deadline: "2026-10-01", truth: "" }] });
    const c = buildCockpit(input([matter([r])]), PATH, TODAY)!;
    expect(c.deadlines.confirmed).toEqual([]);
    expect(provenance(r)).not.toBe("overené");
  });
}
