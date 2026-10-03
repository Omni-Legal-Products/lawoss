import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { symlinkSkipReason } from "../../tests/symlink-capability.mts";
import { render } from "../src/fs";

const cleanup: string[] = [];
const fileSkip = symlinkSkipReason("file");
const dirSkip = symlinkSkipReason("dir");
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "okf-render-link-")));
  cleanup.push(base);
  const root = join(base, "client", "matter");
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

for (const ancestor of [false, true]) {
  test.skipIf(Boolean(dirSkip))(`render refuses a symlink ${ancestor ? "ancestor" : "root"} before any write${dirSkip ? ` (${dirSkip})` : ""}`, () => {
    const { base, root } = fixture();
    const link = join(base, "linked");
    symlinkSync(ancestor ? join(base, "client") : root, link, "dir");
    const before = readdirSync(root).map(path => [path, readFileSync(join(root, path), "utf8")]);
    expect(() => render(ancestor ? join(link, "matter") : link)).toThrow(/symlink|symbolick/i);
    expect(readdirSync(root)).toEqual(before.map(([path]) => path!));
    for (const [path, content] of before) expect(readFileSync(join(root, path!), "utf8")).toBe(content!);
  });
}

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
