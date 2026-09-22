/** Súborová vrstva OKF — jediné miesto, ktoré číta a píše na disk. */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import {
  CARD_ALIASES,
  existingCard,
  WORKING_FOLDERS,
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
import { readConfiguredLawyerName } from "../../okf-pamat/src/config.ts";
import { findOfficeDir } from "../../okf-pamat/src/store.ts";
import { PROFILE_FILE, parseOfficeWorkingProfile, parseWorkingProfile, type WorkingProfile } from "./profile.ts";

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function storedProfile(dir: string): WorkingProfile | undefined {
  const path = join(dir, PROFILE_FILE);
  if (!existsSync(path)) return undefined;
  return parseWorkingProfile(readText(path));
}

function officeProfile(dir: string): WorkingProfile | undefined {
  const office = findOfficeDir(dir);
  if (!office || !existsSync(join(office, "okf.config"))) return undefined;
  const path = join(office, "okf.config");
  if (!statSync(path).isFile()) return undefined;
  return parseOfficeWorkingProfile(readText(path));
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
  const type = ENTITY_TYPES.find((candidate) => CARD_ALIASES[candidate].some((name) => existsSync(join(dir, name)))) ?? null;
  const hasAgents = existsSync(join(dir, "AGENTS.md"));
  const hasClaude = existsSync(join(dir, "CLAUDE.md"));
  const claudeIsMirror = hasAgents && hasClaude ? readText(join(dir, "AGENTS.md")) === readText(join(dir, "CLAUDE.md")) : null;
  const indexPath = join(dir, "index.md");
  const okfVersion = existsSync(indexPath) ? (parseFrontmatter(readText(indexPath))?.okf_version ?? null) : null;
  const effective = type ?? hint ?? null;
  const missing = effective
    ? plan({ type: effective, dir, title: "" }).entries
        .filter((entry) => entry.action === "create").map((entry) => entry.path)
    : [];
  return { ...base, type, hasAgents, hasClaude, claudeIsMirror, okfVersion, markdownCount: listMarkdown(dir).length, missing };
}

export function plan(input: PlanInput): Plan {
  const agents = join(input.dir, "AGENTS.md");
  const templates = existsSync(agents) ? { ...TEMPLATES, [input.type]: { ...TEMPLATES[input.type], "AGENTS.md": readText(agents) } } : TEMPLATES;
  const advokat = input.advokat?.trim() || (input.type === "spis" ? readConfiguredLawyerName(findOfficeDir(input.dir)) : undefined);
  const profile = storedProfile(input.dir) ?? input.workingProfile ?? (input.type === "spis" ? officeProfile(input.dir) : undefined);
  let clientCardPath: string | undefined;
  if (input.type === "spis") {
    for (let parent = dirname(resolve(input.dir)); ; parent = dirname(parent)) {
      const card = existingCard("klient", (name) => existsSync(join(parent, name)));
      if (card) { clientCardPath = relative(input.dir, join(parent, card)).split("\\").join("/"); break; }
      if (dirname(parent) === parent) break;
    }
  }
  const result = planEntity({ ...input, advokat, workingProfile: profile, clientCardPath }, templates, (p) => existsSync(join(input.dir, p)));
  if (existsSync(agents)) {
    const mirror = result.entries.find((entry) => entry.path === "CLAUDE.md" && entry.action === "create");
    if (mirror) mirror.content = readText(agents);
  }
  return result;
}

/** Zapíše IBA položky `create`. Nikdy neprepíše existujúci súbor — kontroluje to znova pri zápise. */
export function apply(p: Plan): { created: string[]; skipped: string[] } {
  const created: string[] = [];
  const skipped: string[] = [];
  // Vlastný pracovný priečinok nesmie presmerovať zápis cez symlink mimo entity.
  // Over celý plán pred prvým zápisom, aby odmietnutie nezanechalo polovičný spis.
  const root = resolve(p.dir);
  const card = existingCard(p.type, (name) => existsSync(join(root, name)));
  const plannedCard = p.entries.find((entry) => CARD_ALIASES[p.type].includes(entry.path));
  if (plannedCard && (card || plannedCard.action === "skip") && card !== plannedCard.path) throw new Error("Karta entity sa od náhľadu zmenila; načítaj nový plán.");
  for (const entry of p.entries.filter((item) => item.action === "create")) {
    const target = resolve(root, entry.path);
    if (!target.startsWith(root + sep)) throw new Error(`Cesta opúšťa priečinok entity: ${entry.path}`);
    for (let part = target; part !== root; part = dirname(part)) {
      if (lstatSync(part, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Cesta vedie cez symbolický odkaz: ${entry.path}`);
    }
  }
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
  const documents = listMarkdown(root);
  const workingPaths: string[] = [];
  for (const rel of documents.filter((path) => path.split("/").pop() === PROFILE_FILE)) {
    try {
      const scope = dirname(join(root, rel));
      for (const folder of storedProfile(scope)?.folders ?? []) workingPaths.push(relative(root, join(scope, folder)).split("\\").join("/") + "/");
    } catch (error) { errors.push({ path: rel, message: error instanceof Error ? error.message : String(error) }); }
  }
  for (const rel of documents) {
    // Source documents and the generated agent entry point are not memory concepts.
    if (workingPaths.some((path) => rel.startsWith(path)) || rel.split("/").some((part) => WORKING_FOLDERS.some((folder) => folder === part)) || rel.split("/").pop() === "BRAIN.md") continue;
    const parent = dirname(join(root, rel));
    const bundleRoot = !rel.includes("/") || basename(parent) === "memory" || ENTITY_TYPES.some((type) => CARD_ALIASES[type].some((name) => existsSync(join(parent, name))));
    const error = validateMarkdown(rel, readText(join(root, rel)), bundleRoot);
    if (error) errors.push(error);
  }
  return errors;
}

/**
 * Pregeneruje odvodené súbory: CLAUDE.md ako mirror AGENTS.md (iba ak chýba
 * alebo sa líši — pôvodný obsah sa pred synchronizáciou zálohuje) a
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
    else {
      const backup = `CLAUDE.md.${Date.now()}.bak`;
      writeFileSync(join(root, backup), readText(claude), { encoding: "utf8", flag: "wx" });
      writeFileSync(claude, a, "utf8");
      written.push(backup, "CLAUDE.md");
    }
  }
  const index = join(root, "index.md");
  if (existsSync(index)) {
    const text = readText(index);
    const fm = parseFrontmatter(text);
    const head = fm ? text.slice(0, text.indexOf("\n---", 3) + 4) : "";
    const cards = listMarkdown(root).filter((rel) => rel.includes("/") && /\/(matter|spis|project|projekt|client|klient)\.md$/.test(rel));
    const body = cards.length
      ? cards.map((rel) => `- [${rel.split("/").slice(0, -1).join("/")}](./${rel})`).join("\n")
      : "_(zatiaľ žiadne)_";
    const next = `${head}\n\n# Obsah\n\n${body}\n`;
    if (next !== text) { writeFileSync(index, next, "utf8"); written.push("index.md"); } else kept.push("index.md");
  }
  return { written, kept };
}
