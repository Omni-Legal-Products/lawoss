import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseFrontmatter, planEntity, renderTemplate, validateMarkdown } from "../src/core.ts";
import { apply, detect, plan, render, validate } from "../src/fs.ts";
import { TEMPLATES } from "../src/templates.ts";
import { run } from "../src/cli.ts";

let root = "";
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "okf-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("core", () => {
  test("renderTemplate fills known keys and blanks unknown ones", () => {
    expect(renderTemplate("a {{TITLE}} b {{NOPE}} c", { TITLE: "X" })).toBe("a X b  c");
  });
  test("parseFrontmatter reads simple keys and unquotes", () => {
    expect(parseFrontmatter('---\ntype: spis\nico: "123"\n---\nbody')).toEqual({ type: "spis", ico: "123" });
    expect(parseFrontmatter("no frontmatter")).toBeNull();
  });
  test("planEntity is pure: exists() decides create vs skip", () => {
    const p = planEntity({ type: "spis", dir: "/x", title: "Vec", date: "2026-09-02" }, TEMPLATES, (path) => path === "AGENTS.md");
    const byPath = Object.fromEntries(p.entries.map((e) => [e.path, e.action]));
    expect(byPath["spis.md"]).toBe("create");
    expect(byPath["AGENTS.md"]).toBe("skip");
    expect(byPath["CLAUDE.md"]).toBe("create");
    expect(p.entries.find((e) => e.path === "spis.md")?.content).toContain("type: spis");
  });
  test("validateMarkdown enforces v0.1 rules", () => {
    expect(validateMarkdown("x.md", "just text", true)?.message).toContain("type:");
    expect(validateMarkdown("x.md", "---\ntype: spis\n---\n", true)).toBeNull();
    expect(validateMarkdown("index.md", "# list", true)).toBeNull();
    expect(validateMarkdown("a/index.md", "---\nokf_version: \"0.1\"\n---\n", false)?.message).toContain("nesmie");
    expect(validateMarkdown("index.md", "---\nokf_version: \"0.1\"\ntitle: x\n---\n", true)?.message).toContain("iba okf_version");
    expect(validateMarkdown("log.md", "anything", true)).toBeNull();
  });
});

describe("fs", () => {
  test("detect on an empty folder reports no OKF and what is missing", () => {
    const d = detect(root, "klient");
    expect(d.type).toBeNull();
    expect(d.missing).toContain("klient.md");
    expect(d.missing).toContain("AGENTS.md");
  });
  test("apply creates only missing files; a second apply changes nothing", () => {
    const input = { type: "klient" as const, dir: root, title: "ACME s.r.o.", ico: "12345678", date: "2026-09-02" };
    const first = apply(plan(input));
    expect(first.created).toContain("klient.md");
    expect(first.created).toContain("CLAUDE.md");
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(readFileSync(join(root, "AGENTS.md"), "utf8"));
    const second = apply(plan(input));
    expect(second.created).toEqual([]);
    expect(second.skipped.length).toBe(first.created.length);
  });
  test("apply never overwrites a pre-existing file (retrofit contract)", () => {
    writeFileSync(join(root, "AGENTS.md"), "MOJE VLASTNE\n");
    apply(plan({ type: "spis", dir: root, title: "Vec", date: "2026-09-02" }));
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("MOJE VLASTNE\n");
    expect(existsSync(join(root, "spis.md"))).toBe(true);
  });
  test("a scaffolded folder validates; a hand-made one without type: does not", () => {
    apply(plan({ type: "spis", dir: root, title: "Vec", date: "2026-09-02" }));
    expect(validate(root)).toEqual([]);
    writeFileSync(join(root, "poznamka.md"), "bez frontmatteru\n");
    expect(validate(root).map((e) => e.path)).toEqual(["poznamka.md"]);
  });
  test("a folder written by hand from AGENTS.md alone passes validate (portability rule)", () => {
    // Bez CLI: advokát alebo iný harness vytvorí súbory ručne — musí to prejsť.
    writeFileSync(join(root, "spis.md"), "---\ntype: spis\ntitle: Ručne\n---\n# Ručne\n");
    writeFileSync(join(root, "AGENTS.md"), "---\ntype: agents\n---\n# Pokyny\n");
    writeFileSync(join(root, "index.md"), "- spis.md\n");
    expect(validate(root)).toEqual([]);
  });
  test("render mirrors CLAUDE.md only when absent or identical", () => {
    writeFileSync(join(root, "AGENTS.md"), "---\ntype: agents\n---\nA\n");
    expect(render(root).written).toContain("CLAUDE.md");
    writeFileSync(join(root, "CLAUDE.md"), "---\ntype: agents\n---\nUPRAVENE\n");
    const r = render(root);
    expect(r.written).not.toContain("CLAUDE.md");
    expect(r.kept.some((k) => k.startsWith("CLAUDE.md"))).toBe(true);
  });
  test("render lists nested cards in index.md and keeps okf_version", () => {
    apply(plan({ type: "klient", dir: root, title: "ACME", date: "2026-09-02" }));
    mkdirSync(join(root, "Spisy", "Vec A"), { recursive: true });
    apply(plan({ type: "spis", dir: join(root, "Spisy", "Vec A"), title: "Vec A", date: "2026-09-02" }));
    render(root);
    const index = readFileSync(join(root, "index.md"), "utf8");
    expect(index).toContain('okf_version: "0.1"');
    expect(index).toContain("[Spisy/Vec A](./Spisy/Vec A/spis.md)");
  });
});

describe("cli", () => {
  const capture = () => { const lines: string[] = []; return { lines, out: (l: string) => { lines.push(l); } }; };
  test("plan writes nothing and prints + / =", () => {
    const c = capture();
    expect(run(["plan", "spis", root, "--title", "Vec", "--json"], c.out)).toBe(0);
    const parsed = JSON.parse(c.lines.join("\n"));
    expect(parsed.entries.every((e: { content?: string }) => e.content === undefined)).toBe(true);
    expect(existsSync(join(root, "spis.md"))).toBe(false);
  });
  test("apply then validate returns 0; validate on broken folder returns 1", () => {
    expect(run(["apply", "spis", root, "--title", "Vec"], () => {})).toBe(0);
    expect(run(["validate", root], () => {})).toBe(0);
    writeFileSync(join(root, "zle.md"), "x");
    expect(run(["validate", root], () => {})).toBe(1);
  });
  test("bad type is a usage error (exit 2)", () => {
    expect(run(["plan", "kauza", root], () => {})).toBe(2);
  });
});
