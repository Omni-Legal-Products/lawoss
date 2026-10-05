import { describe, expect, test } from "bun:test";
import { sanitizeSegment } from "../src/core";

describe("sanitizeSegment", () => {
  test("lomítko spisové značky nevyrobí druhou úroveň", () => {
    expect(sanitizeSegment("Novák — 43 INS 8294/2021")).toBe("Novák — 43 INS 8294-2021");
  });
  test("zpětné lomítko a vícenásobné oddělovače", () => {
    expect(sanitizeSegment("a\\b//c")).toBe("a-b-c");
  });
  test("path traversal se neprotlačí", () => {
    expect(sanitizeSegment("../../etc")).toBe("etc");
    expect(sanitizeSegment("..")).toBe("bez-nazvu");
  });
  test("skrytý soubor nevznikne", () => {
    expect(sanitizeSegment(".tajny")).toBe("tajny");
  });
  test("prázdný vstup má fallback", () => {
    expect(sanitizeSegment("   ")).toBe("bez-nazvu");
  });
  // Q18: vygenerovaný priečinok musí byť platný na Windows bez ohľadu na to, kde vznikol.
  test("koncové tečky a mezery zmizí, vnitřní zůstanou", () => {
    expect(sanitizeSegment("ACME s. r. o.")).toBe("ACME s. r. o");
    expect(sanitizeSegment("Novák  . . ")).toBe("Novák");
    expect(sanitizeSegment("spis\u00a0")).toBe("spis");
  });
  test("znaky zakázané na Windows nahradí pomlčka", () => {
    expect(sanitizeSegment("a:b?c")).toBe("a-b-c");
    expect(sanitizeSegment('Spor <A> | "B" * C')).toBe("Spor -A- - -B- - C");
    expect(sanitizeSegment("a\u007fb\u0085c")).toBe("abc");
  });
  test("jméno zařízení Windows dostane podtržítko, i s příponou", () => {
    expect(sanitizeSegment("CON")).toBe("CON_");
    expect(sanitizeSegment("nul.txt")).toBe("nul_.txt");
    expect(sanitizeSegment("Com1.")).toBe("Com1_");
    expect(sanitizeSegment("LPT9 ")).toBe("LPT9_");
    expect(sanitizeSegment("Conrad s.r.o.")).toBe("Conrad s.r.o");
    expect(sanitizeSegment("COM10")).toBe("COM10");
  });
  test("délka nejvýš 120 znaků bez půlky emoji a bez koncové mezery", () => {
    expect(sanitizeSegment("a".repeat(200))).toHaveLength(120);
    expect(sanitizeSegment(`${"a".repeat(119)}😀`)).toBe("a".repeat(119));
    expect(sanitizeSegment(`${"a".repeat(119)} b`)).toBe("a".repeat(119));
  });
  test("platné názvy se nemění", () => {
    for (const name of ["Novák — 43 INS 8294-2021", "2026-10 Zmluva o dielo", "Klient A", "[názov]", "Účtovníctvo & dane (2026)"]) expect(sanitizeSegment(name)).toBe(name);
  });
});
