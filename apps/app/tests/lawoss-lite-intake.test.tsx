// Přetažený dokument → věc: originál do 00_K_zarazeni/IN-00N/, řádek pending ve VSTUPY.md.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { pendingInputs } from "../../../lawoss/okf/inputs";
import { renderWorkingProfile, workingProfile } from "../../../lawoss/okf/src/profile";
import { appendInputRow, inputRow, nextInputId, receivedStamp, safeFileName, saveDocumentsToMatter } from "../src/lawoss/lite/matter-intake";
import { LiteMatterView } from "../src/lawoss/lite/pages/matter-page";

const TEMPLATE = "---\ntype: input-register\n---\n\n# Vstupy\n\nText.\n\n| ID | Přijato | Zdroj | Originál | Stav | Výsledné záznamy |\n|---|---|---|---|---|---|\n| IN-001 | 2026-09-22 | datová schránka | zprava.zfo | pending | |\n| IN-007 | 2026-09-23 | e-mail | a.pdf | processed | M-1 |\n\n## Pracovní soubory\n\nDalší text.\n";

describe("registr vstupů", () => {
  test("další ID podle nejvyššího čísla", () => {
    expect(nextInputId(TEMPLATE)).toBe("IN-008");
    expect(nextInputId(null)).toBe("IN-001");
  });
  test("řádek jde na konec tabulky, zbytek souboru beze změny, parser ho vidí jako pending", () => {
    const next = appendInputRow(TEMPLATE, inputRow("IN-008", "2026-09-24T14:32:05+02:00", "00_K_zarazeni/IN-008/smlouva.pdf"), "Věc");
    expect(next.split("\n").filter((l) => !l.includes("IN-008"))).toEqual(TEMPLATE.split("\n"));
    expect(next.indexOf("IN-008")).toBeGreaterThan(next.indexOf("IN-007"));
    expect(next.indexOf("IN-008")).toBeLessThan(next.indexOf("## Pracovní soubory"));
    expect(pendingInputs({ path: "AK/A/B", records: [], intake: next }).map((i) => [i.id, i.received, i.original])).toEqual([
      ["IN-001", "2026-09-22", "zprava.zfo"],
      ["IN-008", "2026-09-24T14:32:05+02:00", "00_K_zarazeni/IN-008/smlouva.pdf"],
    ]);
  });
  test("chybějící registr se založí; registr bez tabulky dostane tabulku", () => {
    const created = appendInputRow(null, inputRow("IN-001", "x", "o"), "Barakat");
    expect(pendingInputs({ path: "", records: [], intake: created }).map((i) => i.id)).toEqual(["IN-001"]);
    const noTable = appendInputRow("# Poznámky\n", inputRow("IN-001", "x", "o"), "B");
    expect(noTable.startsWith("# Poznámky\n")).toBe(true);
    expect(pendingInputs({ path: "", records: [], intake: noTable })).toHaveLength(1);
  });
  test("název souboru bez cesty, svislítek a řídicích znaků; čas s pásmem", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\x\\a|b\n.pdf")).toBe("ab.pdf");
    expect(safeFileName("..")).toBe("dokument");
    expect(receivedStamp(new Date(2026, 8, 24, 14, 32, 5))).toMatch(/^2026-09-24T14:32:05[+-]\d{2}:\d{2}$/);
  });
});

describe("uložení do věci", () => {
  test("uloží originál do inboxu z uloženého pracovného profilu", async () => {
    const binary: string[] = [];
    const profile = renderWorkingProfile(workingProfile(["Prijaté"], { inbox: "Prijaté" }));
    const client = {
      readWorkspaceFile: async (_ws: string, path: string) => {
        if (path.endsWith("PRACOVNY-PROFIL.md")) return { path, bytes: profile.length, content: profile, updatedAt: 1 };
        return { path, bytes: TEMPLATE.length, content: TEMPLATE, updatedAt: 111 };
      },
      writeWorkspaceBinaryFile: async (_ws: string, payload: { path: string }) => { binary.push(payload.path); return { ok: true, path: payload.path, bytes: 1, updatedAt: 1 }; },
      writeWorkspaceFile: async (_ws: string, payload: { path: string }) => ({ ok: true, path: payload.path, bytes: 1, updatedAt: 112 }),
    };

    await saveDocumentsToMatter(client as never, "office", { path: "AK/B/X", title: "X" }, [new File(["a"], "a.pdf")]);

    expect(binary).toEqual(["AK/B/X/Prijaté/IN-008/a.pdf"]);
  });

  test("neplatný uložený pracovný profil zastaví import pred zápisom", async () => {
    const writes: string[] = [];
    const client = {
      readWorkspaceFile: async (_ws: string, path: string) => ({ path, bytes: 10, content: path.endsWith("PRACOVNY-PROFIL.md") ? "---\ntype: nope\n---" : TEMPLATE, updatedAt: 111 }),
      writeWorkspaceBinaryFile: async (_ws: string, payload: { path: string }) => { writes.push(payload.path); return { ok: true, path: payload.path, bytes: 1, updatedAt: 1 }; },
      writeWorkspaceFile: async (_ws: string, payload: { path: string }) => { writes.push(payload.path); return { ok: true, path: payload.path, bytes: 1, updatedAt: 1 }; },
    };

    await expect(saveDocumentsToMatter(client as never, "office", { path: "AK/B/X", title: "X" }, [new File(["a"], "a.pdf")])).rejects.toThrow("Neplatný PRACOVNY-PROFIL.md");
    expect(writes).toEqual([]);
  });

  test("po konfliktu registru zachová jediný originál a zaregistruje ho po novém čtení", async () => {
    const initial = { content: TEMPLATE, updatedAt: 111 };
    const changed = { content: `${TEMPLATE}| IN-008 | 2026-09-24 | jiný zdroj | jiný.pdf | pending | |\n`, updatedAt: 112 };
    let reads = 0;
    const binary: { path: string; baseUpdatedAt?: number | null }[] = [];
    const text: { content: string; baseUpdatedAt?: number | null }[] = [];
    const client = {
      readWorkspaceFile: async (_ws: string, path: string) => {
        if (path.endsWith("PRACOVNY-PROFIL.md")) throw new Error("404 not found");
        return { path, bytes: 0, ...(reads++ === 0 ? initial : changed) };
      },
      writeWorkspaceBinaryFile: async (_ws: string, payload: { path: string; baseUpdatedAt?: number | null }) => {
        binary.push(payload);
        return { ok: true, path: payload.path, bytes: 1, updatedAt: 1 };
      },
      writeWorkspaceFile: async (_ws: string, payload: { content: string; baseUpdatedAt?: number | null }) => {
        text.push(payload);
        if (text.length === 1) throw new Error("409 conflict");
        return { ok: true, path: "AK/B/X/VSTUPY.md", bytes: 1, updatedAt: 113 };
      },
    };

    const saved = await saveDocumentsToMatter(client as never, "office", { path: "AK/B/X", title: "X" }, [new File(["a"], "a.pdf")], new Date(2026, 8, 24, 9, 0));

    expect(binary.map(({ path, baseUpdatedAt }) => ({ path, baseUpdatedAt }))).toEqual([{ path: "AK/B/X/00_K_zarazeni/IN-008/a.pdf", baseUpdatedAt: -1 }]);
    expect(saved).toEqual([{ id: "IN-009", name: "a.pdf", path: "AK/B/X/00_K_zarazeni/IN-008/a.pdf" }]);
    expect(text).toHaveLength(2);
    expect(text[1]?.baseUpdatedAt).toBe(112);
    expect(text[1]?.content).toContain("| IN-009 |");
    expect(text[1]?.content).toContain("00_K_zarazeni/IN-008/a.pdf");
  });

  test("pri nevybavenom konflikte neoznámi úspech a uvedie cestu už uloženého originálu", async () => {
    const path = "AK/B/X/00_K_zarazeni/IN-008/a.pdf";
    let writes = 0;
    const client = {
      readWorkspaceFile: async (_ws: string, currentPath: string) => {
        if (currentPath.endsWith("PRACOVNY-PROFIL.md")) throw new Error("404 not found");
        return { path: currentPath, bytes: 0, content: TEMPLATE, updatedAt: 111 + writes };
      },
      writeWorkspaceBinaryFile: async (_ws: string, payload: { path: string; baseUpdatedAt?: number | null }) => ({ ok: true, path: payload.path, bytes: 1, updatedAt: 1 }),
      writeWorkspaceFile: async () => { writes++; throw new Error("409 conflict"); },
    };

    await expect(saveDocumentsToMatter(client as never, "office", { path: "AK/B/X", title: "X" }, [new File(["a"], "a.pdf")], new Date(2026, 8, 24, 9, 0)))
      .rejects.toThrow(path);
    expect(writes).toBe(2);
  });

  test("originály do vlastní složky IN-00N, registr se doplní s kontrolou verze", async () => {
    let register = { content: TEMPLATE, updatedAt: 111 };
    const binary: string[] = []; const text: { path: string; baseUpdatedAt?: number | null }[] = [];
    const client = {
      readWorkspaceFile: async (_ws: string, path: string) => {
        if (path.endsWith("PRACOVNY-PROFIL.md")) throw new Error("404 not found");
        return { path, bytes: 0, ...register };
      },
      writeWorkspaceBinaryFile: async (_ws: string, p: { path: string }) => { binary.push(p.path); return { ok: true, path: p.path, bytes: 1, updatedAt: 1 }; },
      writeWorkspaceFile: async (_ws: string, p: { path: string; content: string; baseUpdatedAt?: number | null }) => { text.push(p); register = { content: p.content, updatedAt: register.updatedAt + 1 }; return { ok: true, path: p.path, bytes: 1, updatedAt: register.updatedAt }; },
    };
    const files = [new File(["a"], "smlouva.pdf"), new File(["b"], "smlouva.pdf")];
    const saved = await saveDocumentsToMatter(client as never, "office", { path: "AK/B/Barakat/vec", title: "vec" }, files, new Date(2026, 8, 24, 9, 0));
    expect(saved.map((s) => s.id)).toEqual(["IN-008", "IN-009"]);
    expect(binary).toEqual(["AK/B/Barakat/vec/00_K_zarazeni/IN-008/smlouva.pdf", "AK/B/Barakat/vec/00_K_zarazeni/IN-009/smlouva.pdf"]);
    expect(text.map((t) => [t.path, t.baseUpdatedAt])).toEqual([["AK/B/Barakat/vec/VSTUPY.md", 111], ["AK/B/Barakat/vec/VSTUPY.md", 112]]);
  });
  test("chybějící VSTUPY.md se založí (404), jiná chyba čtení zastaví a nic nezapíše", async () => {
    const writes: string[] = [];
    const base = { writeWorkspaceBinaryFile: async (_w: string, p: { path: string }) => { writes.push(p.path); return { ok: true, path: p.path, bytes: 1, updatedAt: 1 }; },
      writeWorkspaceFile: async (_w: string, p: { path: string; baseUpdatedAt?: number | null }) => { writes.push(`${p.path}@${p.baseUpdatedAt}`); return { ok: true, path: p.path, bytes: 1, updatedAt: 1 }; } };
    await saveDocumentsToMatter({ ...base, readWorkspaceFile: async () => { throw new Error("404 not found"); } } as never, "o", { path: "AK/B/X", title: "X" }, [new File(["a"], "a.pdf")]);
    expect(writes).toEqual(["AK/B/X/00_K_zarazeni/IN-001/a.pdf", "AK/B/X/VSTUPY.md@null"]);
    writes.length = 0;
    await expect(saveDocumentsToMatter({ ...base, readWorkspaceFile: async () => { throw new Error("500 boom"); } } as never, "o", { path: "AK/B/X", title: "X" }, [new File(["a"], "a.pdf")])).rejects.toThrow("500");
    expect(writes).toEqual([]);
  });
});

describe("stránka Věc", () => {
  const m = { path: "AK/B/X", title: "X", deadlines: [], openTasks: [], counts: { records: 0, evidence: 0, subjects: 0 } };
  test("s vkládáním: skrytý výběr souborů, nápověda k přetažení a potvrzení uložení", () => {
    const out = renderToStaticMarkup(<MemoryRouter><LiteMatterView matter={m} cockpit={null} busy={null} error={null} onAction={() => {}} onFiles={() => {}} saved="a.pdf (IN-001)" /></MemoryRouter>);
    expect(out).toContain('data-lawoss-lite="intake-input"');
    expect(out).toContain("You can also drag documents here.");
    expect(out).toContain("Saved to the matter: a.pdf (IN-001)");
  });
});
