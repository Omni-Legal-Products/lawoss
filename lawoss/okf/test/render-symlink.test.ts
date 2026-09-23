import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "../src/fs";

function spisWithLink(name: "CLAUDE.md" | "index.md") {
  const base = mkdtempSync(join(tmpdir(), "okf-render-link-"));
  const root = join(base, "vec");
  mkdirSync(root);
  writeFileSync(join(root, "spis.md"), "---\nokf: 1\ntype: spis\ntitle: T\njurisdiction: cz\n---\n");
  writeFileSync(join(root, "AGENTS.md"), "AGENTS obsah\n");
  const outside = join(base, "mimo.md");
  writeFileSync(outside, "---\ntitle: mimo\n---\nNEMENIŤ\n");
  symlinkSync(outside, join(root, name));
  return { root, outside };
}

test("render nezapíše cez symlink CLAUDE.md mimo vec", () => {
  const { root, outside } = spisWithLink("CLAUDE.md");
  expect(() => render(root)).toThrow(/symbolick/);
  expect(readFileSync(outside, "utf8")).toContain("NEMENIŤ");
});

test("render nezapíše cez symlink index.md mimo vec", () => {
  const { root, outside } = spisWithLink("index.md");
  expect(() => render(root)).toThrow(/symbolick/);
  expect(readFileSync(outside, "utf8")).toContain("NEMENIŤ");
});
