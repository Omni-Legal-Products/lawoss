import { describe, expect, test } from "bun:test";
import path from "node:path";
import { childPathWithin, deepestContaining, isPathWithin } from "./path-within.js";

describe("isPathWithin", () => {
  test("Windows: spätné lomky, iný disk, UNC a veľkosť písmen", () => {
    const w = path.win32;
    expect(isPathWithin("C:\\Users\\Jan\\Klienti\\Novak", "C:\\Users\\Jan\\Klienti\\Novak\\Spisy\\2026-03 Zmluva", w)).toBe(true);
    expect(isPathWithin("C:\\Users\\Jan\\Klienti\\Novak", "c:\\users\\jan\\klienti\\novak\\Spisy", w)).toBe(true);
    expect(isPathWithin("C:\\Users\\Jan\\Klienti\\Novak", "C:\\Users\\Jan\\Klienti\\Novak", w)).toBe(true);
    expect(isPathWithin("G:\\My Drive\\Klienti\\Novak", "C:\\Users\\Jan\\Documents\\LAWOSS\\Novak klon", w)).toBe(false);
    expect(isPathWithin("\\\\nas\\share\\Klienti", "C:\\Users\\Jan\\AK", w)).toBe(false);
    expect(isPathWithin("C:\\Users\\Jan\\Klienti\\Novak", "C:\\Users\\Jan\\Klienti\\Novak s.r.o", w)).toBe(false);
    expect(isPathWithin("C:\\Users\\Jan\\Klienti\\Novak", "C:\\Users\\Jan\\Klienti\\Novak\\..\\Iny", w)).toBe(false);
    expect(isPathWithin("C:\\a\\root", "C:\\a\\root\\..foo", w)).toBe(true);
  });

  test("Windows: koreň disku a koreň zdieľania už končia lomkou", () => {
    const w = path.win32;
    for (const root of ["D:\\", "\\\\nas\\share\\", "\\\\nas\\share"]) {
      const inside = w.join(root, "Klienti", "Novak");
      expect(isPathWithin(root, inside, w)).toBe(true);
      expect(isPathWithin(root, w.join(root, "Novak s.r.o", "zmluva.md"), w)).toBe(true);
      expect(isPathWithin(root, root, w)).toBe(true);
      // Prefix `root + sep` (`D:\\`, `\\nas\share\\`) by tu odmietol aj potomka.
      expect(inside.startsWith(w.resolve(root) + w.sep)).toBe(false);
    }
    expect(isPathWithin("D:\\", "d:\\klienti\\novak", w)).toBe(true);
    expect(isPathWithin("D:\\", "E:\\Klienti\\Novak", w)).toBe(false);
    expect(isPathWithin("\\\\nas\\share\\", "\\\\NAS\\Share\\Klienti", w)).toBe(true);
    expect(isPathWithin("\\\\nas\\share\\", "\\\\nas\\share2\\Klienti", w)).toBe(false);
    expect(isPathWithin("\\\\nas\\share\\", "\\\\nas\\other\\Klienti", w)).toBe(false);
    expect(isPathWithin("\\\\nas\\share\\", "D:\\Klienti", w)).toBe(false);
    // Klient pod koreňom disku: súrodenec s rovnakým začiatkom názvu ostáva mimo.
    expect(isPathWithin("D:\\Novak", "D:\\Novak s.r.o\\zmluva.md", w)).toBe(false);
    expect(isPathWithin("\\\\nas\\share\\Novak", "\\\\nas\\share\\Novak s.r.o", w)).toBe(false);
  });

  test("POSIX ostáva bez zmeny", () => {
    const p = path.posix;
    expect(isPathWithin("/Users/jan/Klienti/Novak", "/Users/jan/Klienti/Novak/Spisy/Vec", p)).toBe(true);
    expect(isPathWithin("/Users/jan/Klienti/Novak", "/Users/jan/Klienti/Novak", p)).toBe(true);
    expect(isPathWithin("/Users/jan/Klienti/Novak", "/Users/jan/Klienti/Novak2", p)).toBe(false);
    expect(isPathWithin("/Users/jan/Klienti/Novak", "/Users/jan/Klienti", p)).toBe(false);
  });
});

describe("childPathWithin", () => {
  test("Windows: súbor pod koreňom disku a zdieľania prejde, koreň sám a súrodenec nie", () => {
    const w = path.win32;
    expect(childPathWithin("D:\\", "Spisy/zmluva.md", w)).toBe("D:\\Spisy\\zmluva.md");
    expect(childPathWithin("\\\\nas\\share\\", "Spisy/zmluva.md", w)).toBe("\\\\nas\\share\\Spisy\\zmluva.md");
    expect(childPathWithin("\\\\nas\\share", "Spisy", w)).toBe("\\\\nas\\share\\Spisy");
    for (const root of ["D:\\", "\\\\nas\\share\\"]) {
      expect(childPathWithin(root, ".", w)).toBeNull();
      expect(childPathWithin(root, "Spisy/..", w)).toBeNull();
      expect(childPathWithin(root, "..", w)).toBeNull();
    }
    expect(childPathWithin("D:\\", "E:\\tajne.md", w)).toBeNull();
    expect(childPathWithin("\\\\nas\\share\\", "\\\\nas\\other\\tajne.md", w)).toBeNull();
    // `..` nad koreňom zdieľania (ako nad `D:\`) z neho nevyjde, ostáva vnútri.
    expect(childPathWithin("\\\\nas\\share\\", "../other/tajne.md", w)).toBe("\\\\nas\\share\\other\\tajne.md");
    expect(childPathWithin("D:\\", "../tajne.md", w)).toBe("D:\\tajne.md");
    expect(childPathWithin("D:\\Novak", "../Novak s.r.o/zmluva.md", w)).toBeNull();
    expect(childPathWithin("D:\\Novak", "D:\\Novak s.r.o\\zmluva.md", w)).toBeNull();
    // Koreň inou veľkosťou písmen je stále koreň, nie súbor v ňom.
    expect(childPathWithin("C:\\Klienti\\Novak", "c:/klienti/novak", w)).toBeNull();
    expect(childPathWithin("C:\\Klienti\\Novak", "c:/klienti/novak/zmluva.md", w)).toBe("c:\\klienti\\novak\\zmluva.md");
  });

  test.skipIf(process.platform !== "win32")("Windows: predvolené node:path dáva to isté ako path.win32", () => {
    expect(childPathWithin("D:\\", "Spisy/zmluva.md")).toBe("D:\\Spisy\\zmluva.md");
    expect(childPathWithin("\\\\nas\\share\\", "Spisy/zmluva.md")).toBe("\\\\nas\\share\\Spisy\\zmluva.md");
    expect(childPathWithin("D:\\Novak", "../Novak s.r.o/zmluva.md")).toBeNull();
    expect(isPathWithin("\\\\nas\\share", "\\\\nas\\share\\Novak")).toBe(true);
  });

  test("POSIX: rovnaké pravidlá", () => {
    const p = path.posix;
    expect(childPathWithin("/Users/jan/Novak", "Spisy/zmluva.md", p)).toBe("/Users/jan/Novak/Spisy/zmluva.md");
    expect(childPathWithin("/Users/jan/Novak", ".", p)).toBeNull();
    expect(childPathWithin("/Users/jan/Novak", "../Novak s.r.o/zmluva.md", p)).toBeNull();
    expect(childPathWithin("/", "Users", p)).toBe("/Users");
  });
});

describe("deepestContaining", () => {
  test("vec v klientovi pod kanceláriou patrí klientovi, nie kancelárii", () => {
    const items = [
      { id: "office", path: "C:\\Users\\Jan\\AK" },
      { id: "client", path: "C:\\Users\\Jan\\AK\\Klienti\\Novak" },
      { id: "other", path: "D:\\Archiv" },
    ];
    expect(deepestContaining(items, "C:\\Users\\Jan\\AK\\Klienti\\Novak\\Spisy\\2026-03 Zmluva", path.win32)?.id).toBe("client");
    expect(deepestContaining(items, "C:\\Users\\Jan\\AK\\Office", path.win32)?.id).toBe("office");
    expect(deepestContaining(items, "E:\\Iny", path.win32)).toBeUndefined();
  });
});
