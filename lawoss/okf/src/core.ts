/**
 * OKF core — čistá logika bez súborového systému, aby ju vedela použiť aj
 * appka v prehliadači (náhľad „čo vznikne“) aj CLI (skutočný zápis).
 *
 * Pravidlá OKF v0.1 (Open Knowledge Format), na ktorých stojí skill
 * `novy-spis` MČ: znalosť = adresár Markdown súborov s YAML frontmatterom;
 * každý „concept document“ má povinné neprázdne `type:`; `index.md` je
 * rezervovaný zoznam bez frontmatteru (v koreni smie niesť iba `okf_version`);
 * `log.md` je voliteľná chronológia.
 */


export const OKF_VERSION = "0.1";

export type EntityType = "klient" | "spis" | "projekt";
export const ENTITY_TYPES: readonly EntityType[] = ["klient", "spis", "projekt"];

export type PlanInput = {
  type: EntityType;
  /** Cieľový priečinok entity (existujúci pri retrofite, nový pri založení). */
  dir: string;
  title: string;
  description?: string;
  /** IČO klienta (klient) alebo klient_ico (spis). */
  ico?: string;
  klient?: string;
  protistrana?: string;
  protistranaIco?: string;
  oblast?: string;
  spzn?: string;
  sud?: string;
  /** ISO dátum; predvolene dnes. Test seam. */
  date?: string;
};

export type PlanEntry = {
  /** Relatívne k `dir`. */
  path: string;
  action: "create" | "skip";
  reason?: "exists";
  content?: string;
};

export type Plan = {
  okfVersion: string;
  type: EntityType;
  dir: string;
  entries: PlanEntry[];
};

/**
 * Šablóny per typ: názov súboru → obsah so `{{PLACEHOLDER}}`. Core ich dostáva
 * zvonku — CLI cez textové importy (templates.ts), appka cez Vite `?raw` —
 * takže tento súbor nemá žiadny import a beží aj v prehliadači.
 */
export type TemplateSet = Record<EntityType, Record<string, string>>;

/** Karta entity — jediný súbor, podľa ktorého sa dá typ priečinka spoznať. */
export const CARD_FILE: Record<EntityType, string> = { klient: "klient.md", spis: "spis.md", projekt: "projekt.md" };

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Nahradí `{{KEY}}`; neznámy kľúč sa nahradí prázdnym reťazcom, aby v súbore neostali zátvorky. */
export function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function templateVars(input: PlanInput): Record<string, string> {
  const date = input.date ?? today();
  return {
    TITLE: input.title,
    KLIENT: input.type === "klient" ? input.title : (input.klient ?? ""),
    KLIENT_ICO: input.ico ?? "",
    DESCRIPTION: input.description ?? "",
    RESOURCE: "",
    PROTISTRANA: input.protistrana ?? "",
    PROTISTRANA_ICO: input.protistranaIco ?? "",
    OBLAST: input.oblast ?? "",
    SPZN: input.spzn ?? "",
    SUD: input.sud ?? "",
    DATE: date,
  };
}

/**
 * Zostaví plán: čo by v `dir` vzniklo. `exists` hovorí, čo tam už je — plán
 * nikdy neprepisuje, existujúce súbory sa preskočia. CLAUDE.md je byte-identický
 * mirror AGENTS.md (vstup pre harness-y, ktoré čítajú CLAUDE.md a nie AGENTS.md).
 */
export function planEntity(input: PlanInput, templates: TemplateSet, exists: (relativePath: string) => boolean): Plan {
  const vars = templateVars(input);
  const files = templates[input.type];
  const entries: PlanEntry[] = [];
  const push = (path: string, content: string) => {
    entries.push(exists(path) ? { path, action: "skip", reason: "exists" } : { path, action: "create", content });
  };
  for (const [name, template] of Object.entries(files)) push(name, renderTemplate(template, vars));
  const agents = entries.find((entry) => entry.path === "AGENTS.md");
  push("CLAUDE.md", agents?.content ?? renderTemplate(files["AGENTS.md"], vars));
  if (input.type === "klient") {
    push("index.md", `---\nokf_version: "${OKF_VERSION}"\n---\n\n# ${input.title}\n\n## Spisy\n`);
    push("Spisy/.keep", "");
  }
  return { okfVersion: OKF_VERSION, type: input.type, dir: input.dir, entries };
}

/** Frontmatter medzi prvými dvoma `---`; iba jednoduché `key: value`. */
export function parseFrontmatter(text: string): Record<string, string> | null {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const out: Record<string, string> = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "---") return out;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return null; // neuzavretý frontmatter
}

export type ValidationError = { path: string; message: string };

/**
 * Pravidlá konformity v0.1 pre jeden Markdown súbor. `isRoot` = súbor leží v koreni entity.
 */
export function validateMarkdown(relativePath: string, text: string, isRoot: boolean): ValidationError | null {
  const base = relativePath.split("/").pop() ?? relativePath;
  if (base === "log.md") return null;
  const fm = parseFrontmatter(text);
  if (base === "index.md") {
    if (!fm) return null;
    if (!isRoot) return { path: relativePath, message: "index.md nesmie mať frontmatter (rezervovaný zoznam)" };
    const extra = Object.keys(fm).filter((key) => key !== "okf_version");
    return extra.length ? { path: relativePath, message: "koreňový index.md smie niesť iba okf_version" } : null;
  }
  if (!fm || !fm.type?.trim()) {
    return { path: relativePath, message: "concept document bez neprázdneho `type:` vo frontmatteri" };
  }
  return null;
}

export type DetectResult = {
  dir: string;
  isDir: boolean;
  /** Typ podľa nájdenej karty; null = priečinok bez OKF. */
  type: EntityType | null;
  hasAgents: boolean;
  hasClaude: boolean;
  claudeIsMirror: boolean | null;
  okfVersion: string | null;
  markdownCount: number;
  /** Súbory, ktoré by `plan` pre zistený (alebo zadaný) typ ešte vytvoril. */
  missing: string[];
};
