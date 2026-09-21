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
});
