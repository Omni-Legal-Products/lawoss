// N-A7-6 a review #292: zápis do registra vstupov, ktorý zdieľa appka aj server.
import { expect, test } from "bun:test";
import { codeSpan, inputOriginal, moveInputOriginal, originalCell, pendingInputs } from "../inputs.ts";

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
  expect(moved?.content.split("\n")[3]).toBe("| IN-002 | 2025-09-02 | ruční vložení (LAWOSS) | 01_Podklady/b v2.pdf | pending | |");
  const handed = moveInputOriginal(REGISTER, "01_Podklady/A.PDF", "../M002/01_Podklady/a.pdf", "presunuté do `Spisy/M002/VSTUPY.md`, IN-004");
  expect(handed?.content.split("\n")[2]).toBe("| IN-001 | 2025-09-01 | e-mail | ../M002/01_Podklady/a.pdf | processed | MEM-1; presunuté do `Spisy/M002/VSTUPY.md`, IN-004 |");
  const closed = moveInputOriginal(REGISTER, "00_K_zarazeni/IN-002/b v2.pdf", "../M002/01_Podklady/b.pdf", "presunuté do `Spisy/M002/VSTUPY.md`, IN-005");
  expect(pendingInputs({ path: "Spisy/M001", intake: closed?.content } as never)).toEqual([]);
  expect(moveInputOriginal(REGISTER, "00_K_zarazeni/iný.pdf", "x.pdf")).toBeNull();
});
