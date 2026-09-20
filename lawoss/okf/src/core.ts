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


import { parseFrontmatter } from "./frontmatter.ts";
export { parseFrontmatter } from "./frontmatter.ts";

export const OKF_VERSION = "0.1";
export { WORKING_FOLDERS } from "./profile.ts";
import { PROFILE_FILE, workingProfile, renderWorkingProfile, type WorkingProfile } from "./profile.ts";

export type EntityType = "klient" | "spis" | "projekt";

/** Jurisdikcia veci. Strojová hodnota je malými písmenami — tak ju číta `okf-pamat`. */
export type Jurisdiction = "sk" | "cz";
export const ENTITY_TYPES: readonly EntityType[] = ["klient", "spis", "projekt"];

export type ClientType = "fo" | "fo-podnikatel" | "po" | "iny";
export type MatterKind = "dispute" | "advisory" | "transaction" | "other";
export type MatterMode = "bounded" | "ongoing";

export type PlanInput = {
  clientType?: ClientType;
  country?: string;
  citizenship?: string;
  residenceCountry?: string;
  workingProfile?: WorkingProfile;
  identifierType?: string;
  identifier?: string;
  matterKind?: MatterKind;
  mode?: MatterMode;
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
  /** Kto za spis zodpovedá. Bez hodnoty ostáva v karte `[DOPLNIT]` — nikdy meno natvrdo. */
  advokat?: string;
  /** ISO dátum; predvolene dnes. Test seam. */
  date?: string;
  /**
   * Jurisdikcia veci. Pri `spis` povinná: `okf-pamat` ju číta z karty a bez nej
   * pamäť spisu nezaloží. Karta je jediné miesto pravdy — prepínač pri `init`
   * je len núdzová cesta pre spisy založené inak.
   */
  jurisdiction?: Jurisdiction;
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

/** JSON string escaping is a YAML-compatible subset, including Unicode line separators. */
function yamlString(value: string): string {
  return JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Escape complete dynamic frontmatter values; Markdown bodies keep the original readable text. */
export function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  const substitute = (text: string): string => text.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => vars[key] ?? "");
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(template);
  if (!header) return substitute(template);
  const rendered = header[1].split(/\r?\n/).map((line) => {
    const field = /^([A-Za-z_][A-Za-z0-9_]*:[ \t]*)(.*\{\{[A-Z_]+\}\}.*)$/.exec(line);
    if (!field) return line;
    const raw = field[2];
    const list = /^\[\{\{([A-Z_]+)\}\}\]$/.exec(raw);
    if (list) {
      const item = vars[list[1]];
      return `${field[1]}${item ? `[${yamlString(item)}]` : "[]"}`;
    }
    const value = substitute(raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw);
    // Keep dates and machine enums compatible with existing card readers (notably jurisdictionFromCard).
    const plain = (raw === "{{DATE}}" && /^\d{4}-\d{2}-\d{2}$/.test(value)) ||
      (/^\{\{(?:JURISDICTION|CLIENT_TYPE|MATTER_KIND|MODE)\}\}$/.test(raw) && /^[a-z][a-z-]*$/.test(value));
    return `${field[1]}${plain ? value : yamlString(value)}`;
  }).join("\n");
  return `---\n${rendered}\n---${substitute(template.slice(header[0].length))}`;
}

export function templateVars(input: PlanInput): Record<string, string> {
  const date = input.date ?? today();
  return {
    CLIENT_TYPE: input.clientType ?? "iny",
    COUNTRY: input.country?.toUpperCase() ?? "",
    CITIZENSHIP: input.citizenship?.toUpperCase() ?? "",
    RESIDENCE_COUNTRY: input.residenceCountry?.toUpperCase() ?? "",
    IDENTIFIER_TYPE: input.identifierType ?? (input.ico ? "ICO" : ""),
    IDENTIFIER: input.identifier ?? input.ico ?? "",
    MATTER_KIND: input.matterKind ?? "dispute",
    MODE: input.mode ?? "bounded",
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
    JURISDICTION: input.jurisdiction ?? "",
    ADVOKAT: input.advokat?.trim() || "[DOPLNIT]",
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
  if (input.type === "spis" || input.type === "klient") {
    const selected = input.workingProfile;
    const profile = workingProfile(selected?.folders, selected?.roles, selected?.naming);
    push(PROFILE_FILE, renderWorkingProfile(profile));
    for (const folder of profile.folders) push(`${folder}/.keep`, "");
  }
  return { okfVersion: OKF_VERSION, type: input.type, dir: input.dir, entries };
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
