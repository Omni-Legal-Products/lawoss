// N-A7-6 a review #292: zápis do registra vstupov, ktorý zdieľa appka aj server.
import { expect, test } from "bun:test";
import { codeSpan, inputOriginal, moveInputOriginal, moveInputOriginals, originalCell, pendingInputs } from "../inputs.ts";

const REGISTER = [
  "| ID | Prijaté | Zdroj | Originál | Stav | Výsledné záznamy |", "|---|---|---|---|---|---|",
  "| IN-001 | 2025-09-01 | e-mail | 01_Podklady/a.pdf | processed | MEM-1 |",
  "| IN-002 | 2025-09-02 | ruční vložení (LAWOSS) | [b.pdf](./00_K_zarazeni/IN-002/b%20v2.pdf) | pending | |",
].join("\n");

test("a path in the source cell is a code span: no link, image or HTML, and the fence outlasts backticks inside", () => {
  expect(codeSpan("00_Na_zatriedenie/[klik](e) <img src=x>.pdf")).toBe("`00_Na_zatriedenie/[klik](e) <img src=x>.pdf`");
  expect(codeSpan("a ``b`` c")).toBe("```a ``b`` c```");
  expect(codeSpan("`a`")).toBe("`` `a` ``");
  expect(codeSpan("a|b\nc")).toBe("`a b c`");
});

test("a name that would read as Markdown goes as a link with plain text and an encoded target", () => {
  expect(originalCell("01_Podklady/sken (1).pdf")).toBe("01_Podklady/sken (1).pdf");
  const cell = originalCell("01_Podklady/<b>[x]`y`.pdf");
  expect(cell).toBe("[bxy.pdf](./01_Podklady/%3Cb%3E%5Bx%5D%60y%60.pdf)");
  expect(inputOriginal(cell).target).toBe("./01_Podklady/<b>[x]`y`.pdf");
});

test("a moved file keeps its row; a row handed over to another case is closed with the reason, earlier results kept", () => {
  const moved = moveInputOriginal(REGISTER, "00_K_zarazeni/IN-002/b v2.pdf", "01_Podklady/b v2.pdf");
  expect(moved?.id).toBe("IN-002");
  // N-A9-2: the row had a link, so it keeps one.
  expect(moved?.content.split("\n")[3]).toBe("| IN-002 | 2025-09-02 | ruční vložení (LAWOSS) | [b v2.pdf](./01_Podklady/b%20v2.pdf) | pending | |");
  const handed = moveInputOriginal(REGISTER, "01_Podklady/A.PDF", "../M002/01_Podklady/a.pdf", "presunuté do `Spisy/M002/VSTUPY.md`, IN-004");
  expect(handed?.content.split("\n")[2]).toBe("| IN-001 | 2025-09-01 | e-mail | ../M002/01_Podklady/a.pdf | processed | MEM-1; presunuté do `Spisy/M002/VSTUPY.md`, IN-004 |");
  const closed = moveInputOriginal(REGISTER, "00_K_zarazeni/IN-002/b v2.pdf", "../M002/01_Podklady/b.pdf", "presunuté do `Spisy/M002/VSTUPY.md`, IN-005");
  expect(pendingInputs({ path: "Spisy/M001", intake: closed?.content } as never)).toEqual([]);
  expect(moveInputOriginal(REGISTER, "00_K_zarazeni/iný.pdf", "x.pdf")).toBeNull();
});

test("N-A8-1: a moved folder takes every row under it, by whole folder names; a row can be closed or keep its link", () => {
  const register = [REGISTER, "| IN-003 | 2025-09-03 | e-mail | 00_K_zarazeni/IN-0020/c.pdf | pending | |", "| IN-004 | 2025-09-04 | e-mail | 00_K_zarazeni/IN-002 | pending | |"].join("\n");
  const moved = moveInputOriginals(register, "00_k_zarazeni/IN-002", (rest) => originalCell(["01_Podklady/IN-002", rest].filter(Boolean).join("/")), { folder: true });
  expect(moved?.ids).toEqual(["IN-002", "IN-004"]);
  expect(moved?.content.split("\n").slice(3)).toEqual([
    "| IN-002 | 2025-09-02 | ruční vložení (LAWOSS) | [b v2.pdf](./01_Podklady/IN-002/b%20v2.pdf) | pending | |",
    "| IN-003 | 2025-09-03 | e-mail | 00_K_zarazeni/IN-0020/c.pdf | pending | |",
    "| IN-004 | 2025-09-04 | e-mail | 01_Podklady/IN-002 | pending | |",
  ]);
  // A file is matched only by its own name, never as a folder of other rows.
  expect(moveInputOriginals(register, "00_K_zarazeni/IN-002", () => "x", {})?.ids).toEqual(["IN-004"]);
  const trashed = moveInputOriginals(register, "01_Podklady/a.pdf", () => null, { handedOver: "presunuté do Koša" });
  expect(trashed?.content.split("\n")[2]).toBe("| IN-001 | 2025-09-01 | e-mail | 01_Podklady/a.pdf | processed | MEM-1; presunuté do Koša |");
  expect(moveInputOriginals(register, "01_Podklady", () => "x")).toBeNull();
  // An absolute path on a linked folder (NAS) is a code span: the app reads it as a place outside the client's folder.
  expect(inputOriginal(codeSpan("/Volumes/NAS/Klient SYN/a.pdf")).target).toBe("/Volumes/NAS/Klient SYN/a.pdf");
});

test("N-A9-2: a row whose Original was a Markdown link keeps a link after rename or move", () => {
  const register = [
    "| ID | Prijaté | Zdroj | Originál | Stav | Výsledné záznamy |",
    "|---|---|---|---|---|---|",
    "| IN-011 | 2025-03-01 | e-mail | [fotografia.png](./01_Podklady/IN-011/fotografia.png) | pending | |",
    "| IN-009 | 2025-03-01 | e-mail | [export.json](./01_Podklady/IN-009/export.json) | pending | |",
    "| IN-012 | 2025-03-01 | e-mail | 01_Podklady/IN-012/a.pdf | pending | |",
  ].join("\n");
  const renamed = moveInputOriginals(register, "01_Podklady/IN-011/fotografia.png", () => originalCell("01_Podklady/IN-011/2025-03-01_fotografia stroja.png"));
  expect(renamed?.content.split("\n")[2]).toBe("| IN-011 | 2025-03-01 | e-mail | [2025-03-01_fotografia stroja.png](./01_Podklady/IN-011/2025-03-01_fotografia%20stroja.png) | pending | |");
  const folder = moveInputOriginals(register, "01_Podklady/IN-009", (rest) => originalCell(["01_Podklady/IN-009-export-dat", rest].filter(Boolean).join("/")), { folder: true });
  expect(folder?.content.split("\n")[3]).toBe("| IN-009 | 2025-03-01 | e-mail | [export.json](./01_Podklady/IN-009-export-dat/export.json) | pending | |");
  expect(inputOriginal("[export.json](./01_Podklady/IN-009-export-dat/export.json)").target).toBe("./01_Podklady/IN-009-export-dat/export.json");
  // A plain row stays plain; a linked folder (NAS) stays a code span.
  expect(moveInputOriginals(register, "01_Podklady/IN-012/a.pdf", () => originalCell("01_Podklady/IN-012/b.pdf"))?.content.split("\n")[4]).toBe("| IN-012 | 2025-03-01 | e-mail | 01_Podklady/IN-012/b.pdf | pending | |");
  expect(moveInputOriginals(register, "01_Podklady/IN-011/fotografia.png", () => codeSpan("/Volumes/NAS/a.png"))?.content.split("\n")[2]).toContain("| `/Volumes/NAS/a.png` |");
  expect(moveInputOriginal(register, "01_Podklady/IN-011/fotografia.png", "01_Podklady/IN-011/x.png")?.content.split("\n")[2]).toContain("[x.png](./01_Podklady/IN-011/x.png)");
});
