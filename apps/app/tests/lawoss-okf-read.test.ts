import { describe, expect, test } from "bun:test";

import { LAYER_OF, type RecordType } from "../../../lawoss/okf-pamat/src/schema.ts";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { addDays, buildOverview, deadlineTier, type MatterInput } from "../../../lawoss/okf/read";
import { MAX_MATTERS, readWorkspaceMemory, type OkfReadClient } from "../src/lawoss/okf/read-model";

const TODAY = "2026-09-12";

function rec(type: RecordType, id: string, extra: Partial<OkfRecord> = {}): OkfRecord {
  return {
    okf: 1, id, type, title: `${type} ${id}`, description: "syntetický záznam", layer: LAYER_OF[type],
    jurisdiction: "cz", status: "active", created: TODAY, updated: TODAY, truth: "", timeline: [], ...extra,
  };
}

describe("buildOverview — čistá funkcia nad záznamami", () => {
  test("prázdny workspace vráti nuly, nie výnimku", () => {
    const o = buildOverview([], TODAY);
    expect(o.matters).toEqual([]);
    expect(o.upcomingDeadlines).toEqual([]);
    expect(o.overdue).toEqual([]);
    expect(o.totals).toEqual({ matters: 0, deadlinesWithin7Days: 0, openTasks: 0, overdue: 0, records: 0 });
  });

  test("lehoty zo všetkých vecí sú zoradené, po termíne zvlášť, do 7 dní spočítané", () => {
    const a: MatterInput = {
      path: "AK/N/Novák Jan/Spisy/MSPH 79 INS 1-2026",
      cardFrontmatter: { title: "Novák Jan — insolvence", spisova_znacka: "MSPH 79 INS 1/2026", sud: "MSPH" },
      records: [
        rec("evidence", "E-001", { title: "Usnesení o úpadku", deadlines: ["2026-09-20", "2026-09-10"] }),
        rec("task", "T-001", { deadlines: ["2026-09-14"] }),
      ],
    };
    const b: MatterInput = {
      path: "AK/P/Petrov s.r.o./Spisy/KSBR 1 INS 2-2026",
      records: [rec("matter", "M-001", { title: "Petrov", matter_ref: "KSBR 1 INS 2/2026", court: "KSBR", deadlines: ["2026-09-12"] })],
    };
    const o = buildOverview([a, b], TODAY);
    expect(o.upcomingDeadlines.map((d) => d.date)).toEqual(["2026-09-12", "2026-09-14", "2026-09-20"]);
    expect(o.upcomingDeadlines[0].matter).toEqual({ path: b.path, title: "Petrov", matterRef: "KSBR 1 INS 2/2026", court: "KSBR" });
    expect(o.upcomingDeadlines[2]).toMatchObject({ title: "Usnesení o úpadku", recordId: "E-001", matter: { matterRef: "MSPH 79 INS 1/2026" } });
    expect(o.overdue.map((d) => d.date)).toEqual(["2026-09-10"]);
    expect(o.totals).toMatchObject({ matters: 2, deadlinesWithin7Days: 2, overdue: 1, records: 3 });
  });

  test("otvorené úlohy vynechajú hotové; posledná udalosť je najnovší riadok histórie", () => {
    const m: MatterInput = {
      path: "AK/N/Novák Jan/Spisy/vec",
      records: [
        rec("task", "T-002", { state: "open", assignee: "VR", due: "2026-09-30" }),
        rec("task", "T-001", { state: "done" }),
        rec("task", "T-003"),
        rec("evidence", "E-001", { timeline: [{ date: "2026-09-01", text: "doručené" }, { date: "2026-09-05", text: "prečítané", kind: "note" }] }),
        rec("subject", "S-001", { timeline: [{ date: "2026-09-03", text: "overený" }] }),
      ],
    };
    const [v] = buildOverview([m], TODAY).matters;
    expect(v.openTasks.map((t) => t.id)).toEqual(["T-002", "T-003"]);
    expect(v.openTasks[0]).toEqual({ id: "T-002", title: "task T-002", assignee: "VR", due: "2026-09-30" });
    expect(v.lastEvent).toEqual({ date: "2026-09-05", text: "prečítané" });
    expect(v.counts).toEqual({ records: 5, evidence: 1, subjects: 1 });
    expect(v.title).toBe("vec"); // bez karty aj bez záznamu matter → názov priečinka
    expect(v.matterRef).toBeUndefined();
  });

  test("pomocné funkcie dátumu", () => {
    expect(addDays("2026-09-30", 7)).toBe("2026-10-07");
    expect(addDays("nie-dátum", 7)).toBe("nie-dátum");
    expect(deadlineTier("2026-09-11", TODAY)).toBe("overdue");
    expect(deadlineTier("2026-09-13", TODAY)).toBe("today");
    expect(deadlineTier("2026-09-19", TODAY)).toBe("soon");
    expect(deadlineTier("2026-09-20", TODAY)).toBe("later");
  });
});

// ── read-model nad falošným klientom ─────────────────────────────────────

const record = (id: string, type: RecordType, extra = ""): string => `---
okf: 1
id: ${id}
type: ${type}
title: ${type} ${id}
description: syntetický záznam
layer: ${LAYER_OF[type]}
jurisdiction: cz
status: active
created: 2026-09-01
updated: 2026-09-01
${extra}---

## Truth

Nič.

## History

- 2026-09-01 [created] — založené
`;

const MATTER = "AK/N/Novák Jan/Spisy/MSPH 79 INS 1-2026";

function fakeClient(files: Record<string, string>, log: string[] = []): OkfReadClient {
  const paths = Object.keys(files);
  return {
    listWorkspaceDirectory: async (_ws, path) => {
      log.push(`list ${path}`);
      const prefix = path ? `${path}/` : "";
      const names = new Map<string, "file" | "dir">();
      for (const p of paths) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const [name] = rest.split("/");
        names.set(name, rest.includes("/") ? "dir" : "file");
      }
      if (names.size === 0) throw new Error(`404 ${path}`);
      return { path, truncated: false, entries: [...names].map(([name, kind]) => ({ name, kind, path: `${prefix}${name}` })) };
    },
    readWorkspaceFile: async (_ws, path) => {
      log.push(`read ${path}`);
      const content = files[path];
      if (content === undefined) throw new Error(`404 ${path}`);
      return { path, content, bytes: content.length, updatedAt: 0 };
    },
  };
}

describe("readWorkspaceMemory — čítanie cez server API", () => {
  const files: Record<string, string> = {
    [`${MATTER}/spis.md`]: `---\ntype: spis\ntitle: "Novák Jan — insolvence"\nspisova_znacka: MSPH 79 INS 1/2026\nsud: Městský soud v Praze\nstatus: aktivní\n---\n`,
    [`${MATTER}/memory/M-001-vec.md`]: record("M-001", "matter", "matter_ref: MSPH 79 INS 1/2026\n"),
    [`${MATTER}/memory/E-001-usneseni.md`]: record("E-001", "evidence", "deadlines: [2026-09-15]\n"),
    [`${MATTER}/memory/T-001-uloha.md`]: record("T-001", "task", "state: open\nassignee: VR\n"),
    [`${MATTER}/memory/index.md`]: "---\nokf_version: \"0.2\"\n---\n\n# Rejstřík paměti\n",
    [`${MATTER}/memory/log.md`]: "# Log\n",
    [`${MATTER}/memory/Z-999-rozbity.md`]: "toto nie je záznam\n",
    [`${MATTER}/Dokumenty/podanie.pdf`]: "%PDF",
    "AK/N/Novák Jan/klient.md": "---\ntype: klient\n---\n",
    "AK/.skryty/Klient/Spisy/vec/memory/M-001.md": record("M-001", "matter"),
    "AK/P/Bez spisov/klient.md": "---\ntype: klient\n---\n",
    "Office/memory/R-001-pravidlo.md": record("R-001", "rule"),
  };

  test("nájde vec, prečíta kartu a záznamy, rozbitý súbor preskočí a spočíta", async () => {
    const log: string[] = [];
    const out = await readWorkspaceMemory(fakeClient(files, log), "ws", TODAY);
    expect(out.matters).toHaveLength(1);
    const [m] = out.matters;
    expect(m).toMatchObject({ path: MATTER, title: "Novák Jan — insolvence", matterRef: "MSPH 79 INS 1/2026", court: "Městský soud v Praze", state: "aktivní" });
    expect(m.counts).toEqual({ records: 3, evidence: 1, subjects: 0 });
    expect(m.openTasks).toEqual([{ id: "T-001", title: "task T-001", assignee: "VR", due: undefined }]);
    expect(out.upcomingDeadlines).toEqual([{ date: "2026-09-15", title: "evidence E-001", recordId: "E-001", matter: { path: MATTER, title: "Novák Jan — insolvence", matterRef: "MSPH 79 INS 1/2026", court: "Městský soud v Praze" } }]);
    expect(out.problems).toEqual([{ path: `${MATTER}/memory/Z-999-rozbity.md`, message: expect.stringContaining("frontmatter") }]);
    expect(out.truncated).toBe(false);
    // index.md, log.md, Office/ a skryté priečinky sa nečítajú
    expect(log.some((l) => l.endsWith("index.md") || l.endsWith("log.md"))).toBe(false);
    expect(log.some((l) => l.includes("Office") || l.includes(".skryty"))).toBe(false);
  });

  test("workspace bez AK/ je prázdny prehľad, nie chyba", async () => {
    const out = await readWorkspaceMemory(fakeClient({ "README.md": "x" }), "ws", TODAY);
    expect(out.matters).toEqual([]);
    expect(out.problems).toEqual([]);
  });

  test("vec bez spis.md a bez memory/ sa zaráta s názvom priečinka", async () => {
    const out = await readWorkspaceMemory(fakeClient({ "AK/X/Klient/Spisy/Holá vec/poznamka.txt": "" }), "ws", TODAY);
    expect(out.matters).toEqual([{ path: "AK/X/Klient/Spisy/Holá vec", title: "Holá vec", deadlines: [], openTasks: [], counts: { records: 0, evidence: 0, subjects: 0 } }]);
  });

  test("počet vecí je ohraničený a súbežných čítaní je najviac 6", async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < MAX_MATTERS + 5; i++) many[`AK/A/K/Spisy/vec-${String(i).padStart(3, "0")}/memory/M-001.md`] = record("M-001", "matter");
    let active = 0;
    let peak = 0;
    const base = fakeClient(many);
    const client: OkfReadClient = {
      listWorkspaceDirectory: base.listWorkspaceDirectory,
      readWorkspaceFile: async (ws, path) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 1));
        try { return await base.readWorkspaceFile(ws, path); } finally { active--; }
      },
    };
    const out = await readWorkspaceMemory(client, "ws", TODAY);
    expect(out.matters).toHaveLength(MAX_MATTERS);
    expect(out.truncated).toBe(true);
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });
});
