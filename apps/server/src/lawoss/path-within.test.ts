import { describe, expect, test } from "bun:test";
import path from "node:path";
import { deepestContaining, isPathWithin } from "./path-within.js";

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

  test("POSIX ostáva bez zmeny", () => {
    const p = path.posix;
    expect(isPathWithin("/Users/jan/Klienti/Novak", "/Users/jan/Klienti/Novak/Spisy/Vec", p)).toBe(true);
    expect(isPathWithin("/Users/jan/Klienti/Novak", "/Users/jan/Klienti/Novak", p)).toBe(true);
    expect(isPathWithin("/Users/jan/Klienti/Novak", "/Users/jan/Klienti/Novak2", p)).toBe(false);
    expect(isPathWithin("/Users/jan/Klienti/Novak", "/Users/jan/Klienti", p)).toBe(false);
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
