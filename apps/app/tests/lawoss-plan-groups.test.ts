import { describe, expect, test } from "bun:test";

import { planEntity, type TemplateSet } from "../../../lawoss/okf/src/core";
import { entityTypeFor, targetDir, type NovySpisForm } from "../src/lawoss/okf/compose-prompt";
import { groupPlan, workspaceRelativePath, type PlanGroupItem } from "../src/lawoss/okf/plan-groups";

/**
 * Šablóny nakrátko — appkové `templates.ts` ťahá súbory cez Vite `?raw`, čo mimo
 * buildu nie je k dispozícii. Testujeme triedenie plánu, nie obsah kariet.
 */
const TEMPLATES: TemplateSet = {
  klient: { "klient.md": "---\ntype: klient\n---\n", "AGENTS.md": "---\ntype: agents\n---\n", "MEMORY.md": "---\ntype: memory\n---\n" },
  spis: { "spis.md": "---\ntype: spis\n---\n", "_STATUS.md": "---\ntype: status\n---\n", "AGENTS.md": "---\ntype: agents\n---\n", "MEMORY.md": "---\ntype: memory\n---\n" },
  projekt: { "projekt.md": "---\ntype: projekt\n---\n", "AGENTS.md": "---\ntype: agents\n---\n", "MEMORY.md": "---\ntype: memory\n---\n" },
};

const WORKSPACE = "/Users/x/Workspace";

const form: NovySpisForm = {
  mode: "okf", subject: "pravnicka-osoba", title: "Novák Jan", ico: "12345678",
  country: "CZ", identifierType: "ICO", jurisdikcia: "CZ", verify: true, root: WORKSPACE, protistrana: "",
};

/** Rovnaká cesta ako `previewPlan()`, len so šablónami nezávislými od Vite. */
function rowsFor(next: NovySpisForm, existing: readonly string[] = []) {
  return planEntity(
    { type: entityTypeFor(next.subject), dir: targetDir(next), title: next.title.trim() || "[názov]" },
    TEMPLATES,
    (path) => existing.includes(path),
  ).entries;
}

const labels = (items: PlanGroupItem[]): string[] => items.map((item) => item.label);

describe("plán nového spisu v troch skupinách", () => {
  test("nový klient — plán ukáže, že preverenie zatiaľ neprebehlo", () => {
    const groups = groupPlan(rowsFor(form), { form, workspacePath: WORKSPACE });
    expect(labels(groups.prida)).toEqual(["klient.md", "AGENTS.md", "MEMORY.md", "CLAUDE.md", "index.md", "Spisy/.keep"]);
    expect(groups.zostava).toEqual([]);
    expect(labels(groups.pozornost)).toEqual(["Overenie subjektu"]);
  });

  /** Akceptačné kritérium spec MF 3.2: existujúci súbor sa neprepíše. */
  test("existujúci priečinok — hotové súbory ostávajú a nezapisujú sa nanovo", () => {
    const groups = groupPlan(rowsFor(form, ["klient.md", "AGENTS.md"]), { form, workspacePath: WORKSPACE });
    expect(labels(groups.zostava)).toEqual(["klient.md", "AGENTS.md"]);
    expect(labels(groups.prida)).toEqual(["MEMORY.md", "CLAUDE.md", "index.md", "Spisy/.keep"]);
    expect(groups.zostava[0].note).toContain("neprepisuje");
  });

  /**
   * Spisová značka má vždy lomítko (`MSPH 79 INS 1/2026`). Názov priečinka je
   * jeden segment, názov veci v karte ostáva pôvodný — rozdiel musí advokát vidieť.
   */
  test("názov so spisovou značkou — sanitizácia je upozornenie, nie tichá zmena", () => {
    const spis: NovySpisForm = { ...form, subject: "spis", title: "Novák Jan — MSPH 79 INS 1/2026" };
    const groups = groupPlan(rowsFor(spis), { form: spis, workspacePath: WORKSPACE });
    expect(labels(groups.pozornost)).toEqual(["Novák Jan — MSPH 79 INS 1-2026"]);
    expect(groups.pozornost[0].note).toContain("Novák Jan — MSPH 79 INS 1/2026");
    expect(labels(groups.prida)).toContain("spis.md");
  });

  test("chýbajúce IČO pri právnickej osobe a vypnuté overenie žiadajú pozornosť", () => {
    const bez: NovySpisForm = { ...form, ico: "" };
    expect(labels(groupPlan(rowsFor(bez), { form: bez, workspacePath: WORKSPACE }).pozornost)).toEqual(["ICO", "Overenie subjektu"]);

    const neovereny: NovySpisForm = { ...form, verify: false };
    expect(labels(groupPlan(rowsFor(neovereny), { form: neovereny, workspacePath: WORKSPACE }).pozornost)).toEqual(["Overenie subjektu"]);

    // Fyzická osoba ani projekt v registri nie sú — prázdne IČO tam nie je vada.
    const fo: NovySpisForm = { ...form, subject: "fyzicka-osoba", ico: "", verify: false };
    expect(groupPlan(rowsFor(fo), { form: fo, workspacePath: WORKSPACE }).pozornost).toEqual([]);
  });

  test("prázdny povinný názov žiada pozornosť", () => {
    const bez: NovySpisForm = { ...form, title: "   " };
    expect(labels(groupPlan(rowsFor(bez), { form: bez, workspacePath: WORKSPACE }).pozornost)).toEqual(["Názov", "Overenie subjektu"]);
  });

  test("cesta mimo workspace — agent na ňu potrebuje povolenie", () => {
    const inde: NovySpisForm = { ...form, root: "/Users/x/Dropbox/Klienti" };
    const groups = groupPlan(rowsFor(inde), { form: inde, workspacePath: WORKSPACE });
    expect(labels(groups.pozornost)).toEqual(["Overenie subjektu", "/Users/x/Dropbox/Klienti/Novák Jan"]);
    expect(groups.pozornost[1].note).toContain("mimo workspace");
    // Bez známeho workspace-u sa cesta neposudzuje — nehádame, že je mimo.
    expect(labels(groupPlan(rowsFor(inde), { form: inde, workspacePath: "" }).pozornost)).toEqual(["Overenie subjektu"]);
  });

  test("workspaceRelativePath vráti cestu pre server, alebo null pri ceste mimo", () => {
    expect(workspaceRelativePath(`${WORKSPACE}/Novák Jan`, WORKSPACE)).toBe("Novák Jan");
    expect(workspaceRelativePath(`${WORKSPACE}/Novák Jan`, `${WORKSPACE}/`)).toBe("Novák Jan");
    expect(workspaceRelativePath(WORKSPACE, WORKSPACE)).toBe("");
    expect(workspaceRelativePath("/Users/x/Workspace-zaloha/Vec", WORKSPACE)).toBeNull();
    expect(workspaceRelativePath("/Users/x/Dropbox/Vec", WORKSPACE)).toBeNull();
    expect(workspaceRelativePath("/Users/x/Dropbox/Vec", "")).toBeNull();
  });
});
