import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { serializeRecord, type OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { validateStore } from "../../../lawoss/okf-pamat/src/validate.ts";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { buildCockpit } from "../../../lawoss/okf/cockpit";
import { readWorkspaceMemory, type OkfReadClient } from "../src/lawoss/okf/read-model";
import { MatterCockpit } from "../src/lawoss/domains/spis/spis-page";
import { LiteMatterView } from "../src/lawoss/lite/pages/matter-page";

const TODAY = "2026-10-04";
const MATTER = "AK/N/Novák Jan/Spisy/KSBR 39 INS 1234-2020";

function rec(type: string, id: string, extra: Partial<OkfRecord> = {}): OkfRecord {
  return {
    okf: 1, id, type, title: `${type} ${id}`, description: "syntetický záznam", layer: "L2",
    jurisdiction: "cz", status: "active", created: "2026-10-01", updated: "2026-10-01", truth: "Nič.",
    timeline: [{ date: "2026-10-01", text: "založené", kind: "created" }], ...extra,
  };
}

const cockpitOf = (records: OkfRecord[]) => {
  const input: MatterInput = { path: MATTER, records, recordFiles: { "S-001": `${MATTER}/memory/S-001.md` } };
  const cockpit = buildCockpit({ ...buildOverview([input], TODAY), inputs: [input], problems: [] }, MATTER, TODAY);
  if (!cockpit) throw new Error("cockpit chýba");
  return cockpit;
};

describe("zapojené subjekty v detaile veci", () => {
  test("subjekty a participants zo živých záznamov; meno, rola, kontakt; bez mena a vyradené nie", () => {
    const c = cockpitOf([
      rec("subject", "S-001", { title: "Klient s.r.o.", role: "client" }),
      rec("matter", "M-001", { participants: [
        { name: "Krajský soud v Brně", role: "soud" },
        { name: "Petr Svoboda", role: "protistrana", contact: "petr@example.invalid" },
        { role: "policie" },
      ] }),
      rec("subject", "S-002", { title: "Starý zástupca", status: "superseded" }),
    ]);
    expect(c.parties).toEqual([
      { name: "Klient s.r.o.", role: "klient", recordId: "S-001", file: `${MATTER}/memory/S-001.md` },
      { name: "Krajský soud v Brně", role: "soud", recordId: "M-001", file: `${MATTER}/memory/` },
      { name: "Petr Svoboda", role: "protistrana", contact: "petr@example.invalid", recordId: "M-001", file: `${MATTER}/memory/` },
    ]);
  });

  test("Pro aj Lite ukážu sekciu so subjektmi; bez subjektov sa sekcia skryje", () => {
    const c = cockpitOf([rec("matter", "M-001", { participants: [{ name: "Petr Svoboda", role: "protistrana", contact: "petr@example.invalid" }] })]);
    const pro = renderToStaticMarkup(<MemoryRouter><MatterCockpit cockpit={c} now={TODAY} raw={{}} /></MemoryRouter>);
    expect(pro).toContain("Involved parties");
    expect(pro).toContain("Petr Svoboda");
    expect(pro).toContain("petr@example.invalid");
    const lite = renderToStaticMarkup(<MemoryRouter><LiteMatterView matter={c.matter} cockpit={c} busy={null} error={null} onAction={() => {}} /></MemoryRouter>);
    expect(lite).toContain("data-lawoss-parties");
    expect(lite).toContain("protistrana");

    const empty = cockpitOf([rec("matter", "M-001")]);
    expect(empty.parties).toEqual([]);
    expect(renderToStaticMarkup(<MemoryRouter><MatterCockpit cockpit={empty} now={TODAY} raw={{}} /></MemoryRouter>)).not.toContain("data-lawoss-parties");
  });
});

function fakeClient(files: Record<string, string>): OkfReadClient {
  const paths = Object.keys(files);
  return {
    listWorkspaceDirectory: async (_ws, path) => {
      const prefix = path ? `${path}/` : "";
      const names = new Map<string, "file" | "dir">();
      for (const p of paths) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        names.set(rest.split("/")[0], rest.includes("/") ? "dir" : "file");
      }
      if (names.size === 0) throw new Error(`404 ${path}`);
      return { path, truncated: false, entries: [...names].map(([name, kind]) => ({ name, kind, path: `${prefix}${name}` })) };
    },
    readWorkspaceFile: async (_ws, path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`404 ${path}`);
      return { path, content, bytes: content.length, updatedAt: 0 };
    },
  };
}

test("vec s typom agenta a vlastnou sekciou sa prečíta bez problémov; AGENT_TYPE je len varovanie", async () => {
  const agent = rec("garancia", "G-001", { title: "Banková záruka", sections: [{ heading: "Podmienky", body: "Plnenie na prvú výzvu." }] });
  const matter = rec("matter", "M-001", { participants: [{ name: "Finanční úřad pro Jihomoravský kraj", role: "správce daně" }] });
  const out = await readWorkspaceMemory(fakeClient({
    [`${MATTER}/matter.md`]: "---\ntitle: Novák — daň\nmatter_kind: advisory\n---\n",
    [`${MATTER}/memory/G-001.md`]: serializeRecord(agent),
    [`${MATTER}/memory/M-001.md`]: serializeRecord(matter),
  }), "ws", TODAY);

  expect(out.problems).toEqual([]);
  const records = out.inputs[0]!.records;
  expect(records.find((r) => r.id === "G-001")).toMatchObject({ type: "garancia", layer: "L2", sections: [{ heading: "Podmienky", body: "Plnenie na prvú výzvu." }] });
  const findings = validateStore(records, { today: TODAY });
  expect(findings.some((f) => f.code === "AGENT_TYPE" && f.severity === "warning")).toBe(true);
  expect(findings.some((f) => f.severity === "error")).toBe(false);

  expect(out.totals.records).toBe(2);
  const c = buildCockpit(out, MATTER, TODAY);
  expect(c?.okfValid).toBe(true);
  expect(c?.facts.map((f) => [f.id, f.kind])).toEqual([["G-001", "garancia"]]);
  expect(c?.events).toHaveLength(2);
  expect(c?.parties.map((p) => p.name)).toEqual(["Finanční úřad pro Jihomoravský kraj"]);
});
