/** Súborová vrstva OKF — jediné miesto, ktoré číta a píše na disk. */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import {
  CARD_FILE,
  ENTITY_TYPES,
  type DetectResult,
  type EntityType,
  type Plan,
  type PlanInput,
  type ValidationError,
  parseFrontmatter,
  planEntity,
  validateMarkdown,
} from "./core.ts";
import { TEMPLATES } from "./templates.ts";

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

/** Všetky .md pod `root`, relatívne cesty, bez šablón a skrytých priečinkov. */
export function listMarkdown(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "templates" || entry.name === "node_modules") continue;
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        out.push(relative(root, full).split("\\").join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
}

export function detect(dir: string, hint?: EntityType): DetectResult {
  const isDir = existsSync(dir) && statSync(dir).isDirectory();
  const base: DetectResult = {
    dir, isDir, type: null, hasAgents: false, hasClaude: false, claudeIsMirror: null,
    okfVersion: null, markdownCount: 0, missing: [],
  };
  if (!isDir) return base;
  const type = ENTITY_TYPES.find((candidate) => existsSync(join(dir, CARD_FILE[candidate]))) ?? null;
  const hasAgents = existsSync(join(dir, "AGENTS.md"));
  const hasClaude = existsSync(join(dir, "CLAUDE.md"));
  const claudeIsMirror = hasAgents && hasClaude ? readText(join(dir, "AGENTS.md")) === readText(join(dir, "CLAUDE.md")) : null;
  const indexPath = join(dir, "index.md");
  const okfVersion = existsSync(indexPath) ? (parseFrontmatter(readText(indexPath))?.okf_version ?? null) : null;
  const effective = type ?? hint ?? null;
  const missing = effective
    ? planEntity({ type: effective, dir, title: "" }, TEMPLATES, (p) => existsSync(join(dir, p))).entries
        .filter((entry) => entry.action === "create").map((entry) => entry.path)
    : [];
  return { ...base, type, hasAgents, hasClaude, claudeIsMirror, okfVersion, markdownCount: listMarkdown(dir).length, missing };
}

export function plan(input: PlanInput): Plan {
  return planEntity(input, TEMPLATES, (p) => existsSync(join(input.dir, p)));
}

/** Zapíše IBA položky `create`. Nikdy neprepíše existujúci súbor — kontroluje to znova pri zápise. */
export function apply(p: Plan): { created: string[]; skipped: string[] } {
  const created: string[] = [];
  const skipped: string[] = [];
  mkdirSync(p.dir, { recursive: true });
  for (const entry of p.entries) {
    const full = join(p.dir, entry.path);
    if (entry.action !== "create" || existsSync(full)) { skipped.push(entry.path); continue; }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, entry.content ?? "", "utf8");
    created.push(entry.path);
  }
  return { created, skipped };
}

export function validate(root: string): ValidationError[] {
  if (!existsSync(root)) return [{ path: root, message: "priečinok neexistuje" }];
  const errors: ValidationError[] = [];
  for (const rel of listMarkdown(root)) {
    const error = validateMarkdown(rel, readText(join(root, rel)), !rel.includes("/"));
    if (error) errors.push(error);
  }
  return errors;
}

/**
 * Pregeneruje odvodené súbory: CLAUDE.md ako mirror AGENTS.md (iba ak chýba
 * alebo je už mirrorom — vlastnoručne upravený CLAUDE.md sa neprepisuje) a
 * zoznam entít v index.md (iba telo pod frontmatterom, ak index existuje).
 */
export function render(root: string): { written: string[]; kept: string[] } {
  const written: string[] = [];
  const kept: string[] = [];
  const agents = join(root, "AGENTS.md");
  const claude = join(root, "CLAUDE.md");
  if (existsSync(agents)) {
    const a = readText(agents);
    if (!existsSync(claude)) { writeFileSync(claude, a, "utf8"); written.push("CLAUDE.md"); }
    else if (readText(claude) === a) kept.push("CLAUDE.md");
    else kept.push("CLAUDE.md (upravený ručne — nechaný)");
  }
  const index = join(root, "index.md");
  if (existsSync(index)) {
    const text = readText(index);
    const fm = parseFrontmatter(text);
    const head = fm ? text.slice(0, text.indexOf("\n---", 3) + 4) : "";
    const cards = listMarkdown(root).filter((rel) => rel.includes("/") && /\/(spis|projekt|klient)\.md$/.test(rel));
    const body = cards.length
      ? cards.map((rel) => `- [${rel.split("/").slice(0, -1).join("/")}](./${rel})`).join("\n")
      : "_(zatiaľ žiadne)_";
    const next = `${head}\n\n# Obsah\n\n${body}\n`;
    if (next !== text) { writeFileSync(index, next, "utf8"); written.push("index.md"); } else kept.push("index.md");
  }
  return { written, kept };
}
