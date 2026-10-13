import { describe, expect, test } from "bun:test";
import type { LegalworkWorkspaceDirectoryEntry } from "../src/app/lib/legalwork-server";
import {
  DEFAULT_WORKSPACE_FILE_SORT, isSortDirection, isSortKey,
  readWorkspaceFileSort, sortWorkspaceEntries, writeWorkspaceFileSort,
  type WorkspaceFileSort,
} from "../src/react-app/domains/session/panel/workspace-file-sort";

function file(name: string, metadata: Partial<LegalworkWorkspaceDirectoryEntry> = {}): LegalworkWorkspaceDirectoryEntry {
  return { kind: "file", name, path: name, ...metadata };
}
const names = (entries: LegalworkWorkspaceDirectoryEntry[]) => entries.map(entry => entry.name);
const sort = (entries: readonly LegalworkWorkspaceDirectoryEntry[], key: WorkspaceFileSort["key"], direction: WorkspaceFileSort["direction"] = "asc", locale = "cs") => sortWorkspaceEntries(entries, { key, direction }, locale);

describe("workspace file ordering", () => {
  test("natural numeric names use the requested locale, including Czech diacritics", () => {
    const entries = ["číslo10.txt", "číslo2.txt", "cislo2.txt", "záznam.txt", "ábel.txt"].map(name => file(name));
    expect(names(sort(entries, "name"))).toEqual(["ábel.txt", "cislo2.txt", "číslo2.txt", "číslo10.txt", "záznam.txt"]);
    expect(names(sort(entries, "name", "desc"))).toEqual(["záznam.txt", "číslo10.txt", "číslo2.txt", "cislo2.txt", "ábel.txt"]);
    expect(names(sort([file("z.txt"), file("ä.txt")], "name", "asc", "sv"))).toEqual(["z.txt", "ä.txt"]);
    expect(names(sort([file("z.txt"), file("ä.txt")], "name", "asc", "de"))).toEqual(["ä.txt", "z.txt"]);
  });

  for (const key of ["name", "date", "size", "type"] satisfies WorkspaceFileSort["key"][]) {
    for (const direction of ["asc", "desc"] satisfies WorkspaceFileSort["direction"][]) {
      test(`folders remain before files for ${key}/${direction}`, () => {
        const entries = [file("a.txt", { size: 1, updatedAt: 1 }), file("z", { kind: "dir" }), file("b", { kind: "dir", size: 100, updatedAt: 100 }), file("z.zip", { size: 200, updatedAt: 200 })];
        expect(sort(entries, key, direction).map(entry => entry.kind)).toEqual(["dir", "dir", "file", "file"]);
      });
    }
  }

  for (const key of ["date", "size"] satisfies WorkspaceFileSort["key"][]) {
    test(`${key} respects direction and puts unknown/nonfinite values last in both directions`, () => {
      const field = key === "date" ? "updatedAt" : "size";
      const entries = [file("unknown"), file("large", { [field]: 500 }), file("zero", { [field]: 0 }), file("nan", { [field]: NaN }), file("infinite", { [field]: Infinity }), file("negative-infinite", { [field]: -Infinity }), file("small", { [field]: 2 })];
      expect(names(sort(entries, key))).toEqual(["zero", "small", "large", "infinite", "nan", "negative-infinite", "unknown"]);
      expect(names(sort(entries, key, "desc"))).toEqual(["large", "small", "zero", "infinite", "nan", "negative-infinite", "unknown"]);
    });
  }

  test("equal primary values break ties by natural name and then exact path", () => {
    const entries = [file("Item10", { path: "z/Item10", size: 1 }), file("item2", { path: "z/item2", size: 1 }), file("ITEM2", { path: "a/ITEM2", size: 1 })];
    for (const direction of ["asc", "desc"] satisfies WorkspaceFileSort["direction"][]) {
      expect(sort(entries, "size", direction).map(entry => entry.path)).toEqual(["a/ITEM2", "z/item2", "z/Item10"]);
      expect(sort([...entries].reverse(), "size", direction)).toEqual(sort(entries, "size", direction));
    }
    expect(sort(entries.slice(1), "name", "desc").map(entry => entry.path)).toEqual(["a/ITEM2", "z/item2"]);
  });

  test("file types use the last case-insensitive extension; dotfiles and trailing dots have none", () => {
    const entries = ["z.TXT", "b.pdf", ".env.local", "a.PDF", ".gitignore", "README", "end.", "archive.tar.gz"].map(name => file(name));
    expect(names(sort(entries, "type"))).toEqual([".gitignore", "end.", "README", "archive.tar.gz", ".env.local", "a.PDF", "b.pdf", "z.TXT"]);
    expect(names(sort(entries, "type", "desc"))).toEqual(["z.TXT", "a.PDF", "b.pdf", ".env.local", "archive.tar.gz", ".gitignore", "end.", "README"]);
  });

  test("project notes sort by displayed titles, including Windows paths and conflict copies", () => {
    const entries = [file("Note-aaaaaaaa.md", { path: "Notes/Note-aaaaaaaa.md" }), file("Note (copy)-bbbbbbbb.md", { path: "Notes\\Note (copy)-bbbbbbbb.md" }), file("Note-deadbeef (Anna, 2026-09-27 14.06).md", { path: "Notes/Note-deadbeef (Anna, 2026-09-27 14.06).md" })];
    expect(names(sort(entries, "name"))).toEqual(["Note-aaaaaaaa.md", "Note-deadbeef (Anna, 2026-09-27 14.06).md", "Note (copy)-bbbbbbbb.md"]);
    const tiedSizes = entries.map(entry => ({ ...entry, size: 1 }));
    expect(names(sort(tiedSizes, "size", "desc"))).toEqual(names(sort(entries, "name")));
    // Outside the root Notes directory the raw filename stays visible.
    expect(names(sort([file("Z-aaaaaaaa.md", { path: "other/Z-aaaaaaaa.md" }), file("Z.md")], "name"))).toEqual(["Z-aaaaaaaa.md", "Z.md"]);
  });

  test("returns a fresh array, preserves entry identity, and never mutates frozen query data", () => {
    const first = Object.freeze(file("10.txt")), second = Object.freeze(file("2.txt"));
    const input = Object.freeze([first, second]);
    const output = sort(input, "name");
    expect(output).not.toBe(input); expect(output[0]).toBe(second); expect(output[1]).toBe(first);
    expect(input).toEqual([first, second]);
    expect(sort(Object.freeze([]), "name")).toEqual([]);
  });
});

function memoryStorage(values = new Map<string, string>()) {
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("workspace sorting preferences", () => {
  test("defaults to name ascending and validates each supported key/direction", () => {
    expect(DEFAULT_WORKSPACE_FILE_SORT).toEqual({ key: "name", direction: "asc" });
    for (const key of ["name", "date", "size", "type"]) expect(isSortKey(key)).toBe(true);
    for (const value of ["updatedAt", "NAME", null, {}, 1]) expect(isSortKey(value)).toBe(false);
    expect(isSortDirection("asc")).toBe(true); expect(isSortDirection("desc")).toBe(true);
    for (const value of ["ASC", "ascending", null, 1]) expect(isSortDirection(value)).toBe(false);
    const first = readWorkspaceFileSort("one", memoryStorage()); first.key = "size";
    expect(readWorkspaceFileSort("one", memoryStorage())).toEqual(DEFAULT_WORKSPACE_FILE_SORT);
  });

  test("workspace choices are independent and survive a fresh storage adapter", () => {
    const storage = memoryStorage();
    writeWorkspaceFileSort("one/a", { key: "date", direction: "desc" }, storage);
    writeWorkspaceFileSort("one%2Fa", { key: "size", direction: "asc" }, storage);
    const reloaded = memoryStorage(storage.values);
    expect(readWorkspaceFileSort("one/a", reloaded)).toEqual({ key: "date", direction: "desc" });
    expect(readWorkspaceFileSort("one%2Fa", reloaded)).toEqual({ key: "size", direction: "asc" });
    expect(readWorkspaceFileSort("new", reloaded)).toEqual(DEFAULT_WORKSPACE_FILE_SORT);
    expect(storage.values.size).toBe(2);
  });

  test("corrupt JSON, wrong types and unsupported values fall back without changing storage", () => {
    const storage = memoryStorage();
    writeWorkspaceFileSort("one", { key: "type", direction: "desc" }, storage);
    const key = [...storage.values.keys()][0]!;
    for (const raw of ["{", "null", "[]", '"name"', "1", '{}', '{"key":"date"}', '{"key":"date","direction":"DESC"}', '{"key":"updatedAt","direction":"asc"}', '{"key":1,"direction":"asc"}']) {
      storage.values.set(key, raw);
      expect(readWorkspaceFileSort("one", storage)).toEqual(DEFAULT_WORKSPACE_FILE_SORT);
      expect(storage.values.get(key)).toBe(raw);
    }
  });

  test("null workspace IDs never touch storage", () => {
    let accesses = 0;
    const storage = { getItem: () => { accesses++; return null; }, setItem: () => { accesses++; } };
    expect(readWorkspaceFileSort(null, storage)).toEqual(DEFAULT_WORKSPACE_FILE_SORT);
    writeWorkspaceFileSort(null, { key: "size", direction: "desc" }, storage);
    expect(accesses).toBe(0);
  });

  test("blocked storage and unavailable browser storage cannot break sorting", () => {
    const storage = { getItem: () => { throw new Error("Access denied"); }, setItem: () => { throw new Error("Quota exceeded"); } };
    expect(readWorkspaceFileSort("one", storage)).toEqual(DEFAULT_WORKSPACE_FILE_SORT);
    expect(() => writeWorkspaceFileSort("one", { key: "date", direction: "desc" }, storage)).not.toThrow();
    expect(readWorkspaceFileSort("one", null)).toEqual(DEFAULT_WORKSPACE_FILE_SORT);
    expect(() => writeWorkspaceFileSort("one", DEFAULT_WORKSPACE_FILE_SORT, null)).not.toThrow();
  });
});
