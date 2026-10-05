import { afterEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { symlinkSkipReason } from "../../tests/symlink-capability.mts";
import { realPathInside, render } from "../src/fs";

const cleanup: string[] = [];
const fileSkip = symlinkSkipReason("file");
const dirSkip = symlinkSkipReason("dir");
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture(...segments: string[]) {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "okf-render-link-")));
  cleanup.push(base);
  const root = join(base, ...(segments.length ? segments : ["client", "matter"]));
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "spis.md"), "---\nokf: 1\ntype: spis\ntitle: T\njurisdiction: sk\n---\n");
  writeFileSync(join(root, "AGENTS.md"), "Agent instructions\n");
  writeFileSync(join(root, "CLAUDE.md"), "Previous instructions\n");
  writeFileSync(join(root, "index.md"), "---\nokf_version: 1\n---\nPrevious index\n");
  return { base, root };
}

for (const name of ["AGENTS.md", "CLAUDE.md", "index.md"]) {
  for (const dangling of [false, true]) {
    test.skipIf(Boolean(fileSkip))(`render refuses ${dangling ? "dangling " : ""}${name} symlink before any write${fileSkip ? ` (${fileSkip})` : ""}`, () => {
      const { base, root } = fixture();
      const outside = join(base, "outside.md");
      if (!dangling) writeFileSync(outside, "Outside content\n");
      unlinkSync(join(root, name));
      symlinkSync(outside, join(root, name), "file");
      const before = readdirSync(root);
      const untouched = before.filter(path => path !== name).map(path => [path, readFileSync(join(root, path), "utf8")]);
      expect(() => render(root)).toThrow(/symlink|symbolick/i);
      expect(readdirSync(root)).toEqual(before);
      for (const [path, content] of untouched) expect(readFileSync(join(root, path!), "utf8")).toBe(content!);
      if (dangling) expect(existsSync(outside)).toBe(false);
      else expect(readFileSync(outside, "utf8")).toBe("Outside content\n");
    });
  }
}

function expectRendered(root: string) {
  expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe("Agent instructions\n");
  expect(readFileSync(join(root, "index.md"), "utf8")).toContain("# Obsah");
  expect(readdirSync(root).some(name => /^CLAUDE\.md\.\d+\.bak$/.test(name))).toBe(true);
}

// macOS: /tmp a /var sú odkazy na /private/...; staršie ~/Dropbox vedie do ~/Library/CloudStorage.
for (const ancestor of [false, true]) {
  test.skipIf(Boolean(dirSkip))(`render accepts a ${ancestor ? "symlinked ancestor" : "symlinked root"} and writes into its real folder${dirSkip ? ` (${dirSkip})` : ""}`, () => {
    const { base, root } = fixture("private", "client", "matter");
    const link = join(base, "tmp");
    symlinkSync(ancestor ? join(base, "private") : root, link, "dir");
    const result = render(ancestor ? join(link, "client", "matter") : link);
    expect(result.written).toContain("CLAUDE.md");
    expectRendered(root);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });
}

test("render works in a folder with spaces and ~ like iCloud Drive", () => {
  const { root } = fixture("Library", "Mobile Documents", "com~apple~CloudDocs", "Klient Novak", "vec 1");
  render(root);
  expectRendered(root);
});

test.skipIf(Boolean(fileSkip))(`render follows a symlink that stays inside the entity folder${fileSkip ? ` (${fileSkip})` : ""}`, () => {
  const { root } = fixture();
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "sub", "real-index.md"), "---\nokf_version: 1\n---\nPrevious index\n");
  unlinkSync(join(root, "index.md"));
  symlinkSync(join(root, "sub", "real-index.md"), join(root, "index.md"), "file");
  render(root);
  expect(lstatSync(join(root, "index.md")).isSymbolicLink()).toBe(true);
  expect(readFileSync(join(root, "sub", "real-index.md"), "utf8")).toContain("# Obsah");
});

test.skipIf(Boolean(fileSkip))(`render refuses an entity card that links outside before any write${fileSkip ? ` (${fileSkip})` : ""}`, () => {
  const { base, root } = fixture();
  const outside = join(base, "outside-card.md");
  writeFileSync(outside, "---\nokf: 1\ntype: spis\ntitle: Outside\njurisdiction: cz\n---\n");
  unlinkSync(join(root, "spis.md"));
  symlinkSync(outside, join(root, "spis.md"), "file");
  const before = readdirSync(root).filter(name => name !== "spis.md").map(name => [name, readFileSync(join(root, name), "utf8")]);
  expect(() => render(root)).toThrow(/symbolick/i);
  for (const [name, content] of before) expect(readFileSync(join(root, name!), "utf8")).toBe(content!);
});

test("realPathInside refuses .. traversal and resolves missing files under the real root", () => {
  const { base, root } = fixture();
  writeFileSync(join(base, "client", "outside.md"), "Outside\n");
  expect(() => realPathInside(root, "../outside.md")).toThrow(/mimo/);
  expect(() => realPathInside(root, "sub/../../outside.md")).toThrow(/mimo/);
  expect(() => realPathInside(root, join(base, "client", "outside.md"))).toThrow(/mimo/);
  expect(realPathInside(root, "missing/dir/new.md")).toBe(join(root, "missing", "dir", "new.md"));
  expect(realPathInside(root, "sub/../AGENTS.md")).toBe(join(root, "AGENTS.md"));
});

test.skipIf(Boolean(dirSkip))(`realPathInside refuses a missing file below a directory link that leads outside${dirSkip ? ` (${dirSkip})` : ""}`, () => {
  const { base, root } = fixture();
  mkdirSync(join(base, "elsewhere"));
  symlinkSync(join(base, "elsewhere"), join(root, "out"), "dir");
  expect(() => realPathInside(root, "out/new.md")).toThrow(/mimo/);
  mkdirSync(join(root, "in"));
  symlinkSync(join(root, "in"), join(root, "alias"), "dir");
  expect(realPathInside(root, "alias/new.md")).toBe(join(root, "in", "new.md"));
});

test("render still mirrors, backs up and indexes ordinary files", () => {
  const { root } = fixture();
  const result = render(root);
  expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe("Agent instructions\n");
  const backup = result.written.find(name => name.endsWith(".bak"));
  expect(backup).toBeDefined();
  expect(readFileSync(join(root, backup!), "utf8")).toBe("Previous instructions\n");
  expect(readFileSync(join(root, "index.md"), "utf8")).toContain("# Obsah");
  expect(render(root).written).toEqual([]);
});
