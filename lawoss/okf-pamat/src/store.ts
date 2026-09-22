/**
 * Vrstva, ktorá sa dotýka disku.
 *
 * Jediná cesta k zápisu vedie cez applyRecordWrite → authorize. Ak brána
 * odmietne, na disku nevznikne nič — kontrola je pred zápisom, nie po ňom.
 *
 * Jadro sa dotýka výhradne troch vecí: adresára pamäte, BRAIN.md a blokov
 * v _STATUS.md. Dokumenty spisu ani karty nikdy neotvára na zápis.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseRecord, parseFrontmatter, recordRevision, serializeRecord, type OkfRecord } from "./record.ts";
import { renderStatus, retrofitStatus, type LinkResolver, type BlockName } from "./render.ts";
import { validateStore } from "./validate.ts";
import { authorize, assertHasSource, type Approval, type WriteDiff } from "./write.ts";
import { readStandingAuthorization, covers, readClientPath, matchesClientPath, readNameLeakSeverity } from "./config.ts";
import { truthDigest, OKF_VERSION, type Jurisdiction } from "./schema.ts";
import { documentTypeLabel, documentValueLabel, isDocumentLanguage, renderLanguage, type DocumentLanguage, type RenderLanguage } from "./document-language.ts";

/**
 * Rezervované názvy Open Knowledge Format. Musia byť **malými písmenami** —
 * spec hovorí, že každý iný `.md` v bundle je koncept a musí niesť `type`.
 * Náš starý `INDEX.md` bol teda na case-sensitive systéme nekonformný koncept.
 */
const INDEX_FILE = "index.md";
const LOG_FILE = "log.md";
/** Predchodca `index.md`. Číta sa ako rezervovaný, pri zápise sa odstráni. */
const LEGACY_INDEX_FILE = "INDEX.md";
const BRAIN_FILE = "BRAIN.md";
export const STATUS_FILE = "_STATUS.md";

/**
 * Jeden adresár pamäte pre obe jurisdikcie (O6). Jurisdikcia je hodnota poľa
 * v zázname, nie názov priečinka — spis prenesený medzi jurisdikciami sa tým
 * neprepisuje a české aj slovenské záznamy môžu ležať vedľa seba.
 */
export const MEMORY_DIR = "memory";

/** Karty veci, z ktorých sa dá prečítať jurisdikcia prázdneho spisu. */
const MATTER_CARDS = ["matter.md", "spis.md", "project.md", "projekt.md"];

export function jurisdictionFromCard(dir: string): Jurisdiction | undefined {
  for (const name of MATTER_CARDS) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const m = /^jurisdiction:\s*(cz|sk)\s*$/m.exec(readFileSync(path, "utf8"));
    if (m?.[1] === "cz" || m?.[1] === "sk") return m[1];
  }
  return undefined;
}

/** UI language is persisted at creation; changing the UI later does not rewrite a matter. */
export function documentLanguageFromCard(dir: string): DocumentLanguage | undefined {
  for (const name of [...MATTER_CARDS, "client.md", "klient.md"]) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(readFileSync(path, "utf8"))?.[1];
    if (!header) continue;
    // Cards may contain valid multiline YAML or custom nested fields unsupported by
    // the intentionally strict memory-record parser. Inspect only our top-level scalar.
    const languageLines = header.split(/\r?\n/).filter(line => /^language[ \t]*:/.test(line));
    if (languageLines.length > 1) throw new Error(`Duplicate document language in ${name}.`);
    const languageLine = languageLines[0];
    if (languageLine === undefined) continue;
    const value = parseFrontmatter(languageLine).get("language");
    if (!isDocumentLanguage(value)) throw new Error(`Unsupported document language in ${name}; use cs, sk or en.`);
    return value;
  }
  return undefined;
}

/** Súbor, ktorý sa nepodarilo prečítať. Jeden zlý súbor nesmie skryť zvyšok spisu. */
export interface StoreProblem {
  readonly file: string;
  readonly message: string;
}

export interface Store {
  readonly dir: string;
  readonly jurisdiction: Jurisdiction;
  readonly memoryDir: string;
  readonly records: OkfRecord[];
  readonly problems: StoreProblem[];
}

/** Detect body content the canonical parser cannot preserve, without printing raw personal data. */
function hasUnparsedBody(text: string): boolean {
  const lines = text.split("\n");
  const body = lines.slice(lines.indexOf("---", 1) + 1);
  let section = "";
  const seen = new Set<string>();
  for (const line of body) {
    if (!line.trim()) continue;
    if (/^##\s+/.test(line)) {
      const heading = /^##\s+(Truth|History)\s*$/.exec(line)?.[1];
      if (!heading || seen.has(heading)) return true;
      seen.add(heading);
      section = heading;
    } else if (section === "Truth") {
      continue;
    } else if (section !== "History" || !/^-\s*\d{4}-\d{2}-\d{2}\s*(?:\[[a-z_]+\]\s*)?[—-]\s*.*$/.test(line.trim())) {
      return true;
    }
  }
  return false;
}

export function readStore(dir: string): Store {
  const memoryDir = join(dir, MEMORY_DIR);
  const records: OkfRecord[] = [];
  const problems: StoreProblem[] = [];
  try {
    for (const entry of readdirSync(memoryDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = entry.name;
      if (entry.isDirectory()) {
        problems.push({ file: name, message: "Vnorený adresár pamäte nie je podporovaný; jeho záznamy neboli načítané." });
        continue;
      }
      if (!name.endsWith(".md")) continue;
      if (name === INDEX_FILE || name === LOG_FILE || name === LEGACY_INDEX_FILE) continue;
      try {
        const source = readFileSync(join(memoryDir, name), "utf8");
        records.push(parseRecord(source));
        if (hasUnparsedBody(source)) {
          problems.push({ file: join(memoryDir, name), message: "Časť obsahu mimo podporovaných sekcií Truth/History alebo riadkov History sa nedá načítať. Otvor celý zdrojový súbor; tento výpis nie je úplný." });
        }
      } catch (e) {
        problems.push({ file: name, message: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      problems.push({ file: memoryDir, message: error instanceof Error ? error.message : String(error) });
    }
  }
  // Jurisdikcia slúži už len na lokalizáciu výstupu. Berie sa zo záznamov;
  // prázdny spis ju má na karte veci, inak sa predpokladá česká.
  let j: Jurisdiction | undefined = records[0]?.jurisdiction;
  if (!j) {
    try {
      j = jurisdictionFromCard(dir);
    } catch (error) {
      problems.push({ file: dir, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { dir, jurisdiction: j ?? "cz", memoryDir, records, problems };
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function fileFor(store: Store, r: OkfRecord): string {
  const existing = existsSync(store.memoryDir)
    ? readdirSync(store.memoryDir).find((n) => n.startsWith(`${r.id}-`) || n === `${r.id}.md`)
    : undefined;
  const target = join(store.memoryDir, existing ?? `${r.id}-${slug(r.title)}.md`);
  if (existing && parseRecord(readFileSync(target, "utf8")).id !== r.id) {
    throw new ConcurrentWriteError(`Cieľový súbor je obsadený iným ID než ${r.id}; zápis alebo mazanie bolo odmietnuté.`);
  }
  return target;
}

export class LeakBlockedError extends Error {}

/**
 * Výslovná žiadosť knižničného volajúceho konať pod trvalým poverením.
 *
 * Bez nej `undefined` znamená „bez schválenia" a brána do L1/L3 drží — aj keď
 * poverenie v konfigu je. Aplikácia, ktorá o poverení nevie, ho nesmie dostať
 * automaticky; musí si oň povedať. CLI si oň hovorí samo.
 */
export const STANDING: unique symbol = Symbol("okf.standing-authorization");
export type ApprovalInput = Approval | typeof STANDING | undefined;
export class ConcurrentWriteError extends Error {}

/**
 * Optimistická kontrola celého uloženého obsahu, vrátane zmien v ten istý deň.
 *
 * Append-only história konflikt zmierňuje — dva zápisy sa dajú zliať —
 * ale `## Truth` je last-write-wins a tichá strata cudzej práce je presne
 * to, čo advokát zistí až vtedy, keď je neskoro.
 */
function assertNotStale(store: Store, diff: WriteDiff): void {
  const before = diff.before;
  const matches = store.records.filter((r) => r.id === diff.id);
  if (store.problems.length || matches.length > 1) {
    throw new ConcurrentWriteError(`Pamäť obsahuje nečitateľné záznamy alebo duplicitné id ${diff.id}; oprav ju pred zápisom.`);
  }
  const naDisku = matches[0];
  if (!before && !naDisku) return;
  if (before && naDisku && recordRevision(naDisku) === recordRevision(before)) return;
  throw new ConcurrentWriteError(
    `Záznam ${diff.id} sa medzitým zmenil: vychádzaš zo stavu ${before?.updated ?? "nový záznam"}, ` +
      `na disku je ${naDisku?.updated ?? "záznam odstránený"}. Načítaj ho znova a zápis zopakuj.`,
  );
}

/**
 * Štvrtá brána — zákaz úniku klientskych identifikátorov do zdieľateľnej
 * vrstvy L3. Beží **iba pre L3**: v spise sú identifikátory legitímne
 * a `validate.ts` ich tam aj tak preskakuje.
 *
 * Kontrola musí vidieť aj klientsku úroveň. AML subjekty žijú u klienta,
 * prameň sa zapisuje v spise — keby brána čítala iba spis, nevidela by
 * práve tie identifikátory, kvôli ktorým existuje.
 */
function assertNoLeak(dir: string, after: OkfRecord): void {
  if (after.layer !== "L3") return;
  const scope = readScope(dir);
  // Nečitateľný subjekt = chýbajúce jehly = brána, ktorá nič nezastaví a nikto
  // sa to nedozvie. Obsidian pridá viacriadkový `aliases:`, súbor sa nedá
  // prečítať, subjekt vypadne — a prameň s jeho IČO prejde. Preto sa pri
  // nečitateľnom súbore v dosahu do L3 nezapisuje vôbec.
  if (scope.problems.length > 0) {
    const subory = scope.problems.map((p) => p.file).join(", ");
    throw new LeakBlockedError(
      `Zápis záznamu ${after.id} odmietnutý — v dosahu spisu sú nečitateľné záznamy (${subory}), ` +
        `takže brána úniku by bola slepá. Oprav ich alebo presuň mimo ${MEMORY_DIR}/.`,
    );
  }
  const ostatne = scope.records.filter((r) => r.id !== after.id);
  const chyby = validateStore([...ostatne, after], {
    nameLeakSeverity: readNameLeakSeverity(findOfficeDir(dir)),
  }).filter(
    (f) => f.recordId === after.id && f.severity === "error" && f.code === "L3_LEAK",
  );
  if (chyby.length === 0) return;
  throw new LeakBlockedError(
    `Zápis záznamu ${after.id} odmietnutý — ${chyby.map((f) => f.message).join(" ")}`,
  );
}

/** Zapíše návrh na disk — najprv však prejde bránami. */
/**
 * Schválenie plynúce z trvalého poverenia advokáta v `Office/okf.config`.
 *
 * Nie je to obídenie brány — je to schválenie udelené vopred a písomne,
 * namiesto klikania pri každom zázname. Preto ide tou istou cestou ako ručné
 * a rovnako sa zapíše do append-only histórie záznamu.
 */
export function standingApproval(
  dir: string,
  diff: WriteDiff,
  today?: string,
): Approval | undefined {
  const auth = readStandingAuthorization(findOfficeDir(dir));
  if (!auth || !covers(auth, diff, today)) return undefined;
  return {
    by: `${auth.by} (trvalé poverenie do ${auth.expiresAt})`,
    at: new Date().toISOString(),
  };
}

/**
 * @param leakScopeDir Spis, z ktorého zápis prichádza. Keď CLI smeruje L1/L3
 *   do kancelárie, `dir` je kancelária — ale jehly úniku musia prísť zo spisu
 *   a jeho klienta, inak by presmerovanie bránu oslepilo.
 */
export function applyRecordWrite(
  dir: string,
  diff: WriteDiff,
  approval: ApprovalInput,
  leakScopeDir: string = dir,
): void {
  // An ID becomes a filename; check every supplied version before authorization reads or disk writes.
  for (const id of [diff.id, ...(diff.before ? [diff.before.id] : []), ...(diff.after ? [diff.after.id] : [])]) {
    if (typeof id !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(id)) {
      throw new Error("Neplatné ID záznamu: použi písmená, číslice, pomlčku alebo podčiarkovník; ID nesmie byť cesta.");
    }
  }
  authorize(diff, approval === STANDING ? standingApproval(dir, diff) : approval);
  if (diff.after) assertNoLeak(leakScopeDir, diff.after);
  assertHasSource(diff.after);
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, ".okf-write.lock");
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new ConcurrentWriteError(`Pamäť ${dir} je zamknutá iným zápisom. Zopakuj zápis po jeho dokončení. Po páde procesu odstráň ${lock} až po overení, že žiadny zápis nebeží.`);
    }
    throw error;
  }
  try {
    const store = readStore(dir);
    assertNotStale(store, diff);
    mkdirSync(store.memoryDir, { recursive: true });
    if (diff.kind === "delete") {
      if (diff.before) rmSync(fileFor(store, diff.before));
      return;
    }
    const after = diff.after;
    if (!after) throw new Error(`Návrh ${diff.kind} nemá nový stav záznamu`);
    const zapis: OkfRecord = { ...after, truth_digest: truthDigest(after.truth) };
    const target = fileFor(store, zapis);
    if (diff.kind === "create" && existsSync(target)) {
      throw new ConcurrentWriteError(`Cieľový súbor pre ID ${zapis.id} už existuje; možná kolízia veľkosti písmen. Zvoľ iné ID.`);
    }
    if (diff.kind === "update" && !existsSync(target)) {
      throw new ConcurrentWriteError(`Súbor pre ID ${zapis.id} sa nenašiel pod očakávaným názvom; zápis bol odmietnutý.`);
    }
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, serializeRecord(zapis), { encoding: "utf8", flag: "wx", mode: 0o600 });
      renameSync(temporary, target);
    } finally {
      rmSync(temporary, { force: true });
    }
  } finally {
    rmSync(lock, { recursive: true });
  }
}

/**
 * Mapa identifikátor → skutočný názov súboru v `memory/`.
 *
 * Cesty sa berú z disku, nie sa dopočítavajú zo `slug(title)`: keď sa titulok
 * záznamu neskôr zmení, súbor si ponechá pôvodný názov a dopočítaná cesta by
 * mierila vedľa.
 */
function linkResolver(store: Store, zVnutraMemory: boolean): LinkResolver {
  const podlaId = new Map<string, string>();
  if (existsSync(store.memoryDir)) {
    for (const name of readdirSync(store.memoryDir)) {
      if (!name.endsWith(".md") || [INDEX_FILE, LOG_FILE, LEGACY_INDEX_FILE].includes(name)) continue;
      try {
        const { id } = parseRecord(readFileSync(join(store.memoryDir, name), "utf8"));
        if (!podlaId.has(id)) podlaId.set(id, name);
      } catch {
        // readStore reports unreadable records; never invent a source link from their filenames.
      }
    }
  }
  return (id) => {
    const name = podlaId.get(id);
    if (!name) return undefined;
    return zVnutraMemory ? `./${name}` : `./${MEMORY_DIR}/${name}`;
  };
}

/** Refuse to overwrite a complete projection with an incomplete read. */
function completeScope(dir: string): Scope {
  const scope = readScope(dir);
  if (scope.problems.length) throw new Error(`NEÚPLNÉ ČÍTANIE: ${scope.problems.map((p) => `${p.file}: ${p.message}`).join("; ")}`);
  return scope;
}

function scopeLinkResolver(dir: string, insideMemory: boolean): LinkResolver {
  const scope = readScope(dir);
  const stores = [scope.matter, ...[scope.clientDir, scope.officeDir].flatMap((path) => path ? [readStore(path)] : [])];
  const sources = stores.map((store) => ({ memoryDir: store.memoryDir, href: linkResolver(store, true) }));
  return (id) => {
    for (const source of sources) {
      const href = source.href(id);
      if (href) return "./" + relative(insideMemory ? join(dir, MEMORY_DIR) : dir, join(source.memoryDir, href)).split(sep).join("/");
    }
    return undefined;
  };
}

/** Resolver shared by preview and the written status. */
export function statusLinkResolver(dir: string): LinkResolver {
  return scopeLinkResolver(dir, false);
}

export class ProjectionWriteError extends Error {}

function projectionStat(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Check the selected root and every directory between it and its client, without following links. */
function assertProjectionDirectory(dir: string, boundary = dir): void {
  for (let path = resolve(dir); ; path = dirname(path)) {
    const info = projectionStat(path);
    if (info && (info.isSymbolicLink() || !info.isDirectory())) {
      throw new ProjectionWriteError(`Nebezpečný cieľ projekcie ${path}: symbolický odkaz alebo nepravidelný adresár.`);
    }
    if (path === resolve(boundary) || dirname(path) === path) break;
  }
}

function assertProjectionFile(path: string, root: string): void {
  assertProjectionDirectory(dirname(path), root);
  const info = projectionStat(path);
  if (info && (info.isSymbolicLink() || !info.isFile())) {
    throw new ProjectionWriteError(`Nebezpečný cieľ projekcie ${path}: symbolický odkaz alebo iný než bežný súbor.`);
  }
}

function preflightBundleProjections(dir: string): void {
  assertProjectionDirectory(dir);
  assertProjectionDirectory(join(dir, MEMORY_DIR), dir);
  for (const name of [INDEX_FILE, LEGACY_INDEX_FILE, LOG_FILE]) assertProjectionFile(join(dir, MEMORY_DIR, name), dir);
}

/** Replace the directory entry, so even a raced-in file symlink/hard link cannot overwrite its referent. */
function writeProjection(path: string, content: string, root: string): void {
  assertProjectionFile(path, root);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: projectionStat(path)?.mode ?? 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Preflight every matter/client destination before the first sync mutation. */
export function syncProjections(dir: string): void {
  const clientDir = findClientDir(dir);
  documentLanguageFromCard(dir);
  if (clientDir) documentLanguageFromCard(clientDir);
  assertProjectionDirectory(dir, clientDir ?? dir);
  assertProjectionFile(join(dir, STATUS_FILE), dir);
  preflightBundleProjections(dir);
  if (clientDir) preflightBundleProjections(clientDir);
  syncStatus(dir);
  writeIndex(dir);
  writeLog(dir);
  if (clientDir) {
    writeIndex(clientDir);
    writeLog(clientDir);
  }
}

export function writeIndex(dir: string): void {
  preflightBundleProjections(dir);
  const scope = completeScope(dir);
  const store = scope.matter;
  if (!existsSync(store.memoryDir)) return;
  const j = renderLanguage(documentLanguageFromCard(dir), store.jurisdiction);
  const href = scopeLinkResolver(dir, true);

  // Tvar podľa OKF: sekcie s odrážkami `* [Titul](cesta) - popis`, nie tabuľka.
  // Frontmatter smie mať iba koreňový index, a iba `okf_version`.
  const nadpis: Record<string, Record<RenderLanguage, string>> = {
    L1: { cz: "Kancelář (L1)", sk: "Kancelária (L1)", en: "Office (L1)" },
    L2: { cz: "Spis (L2)", sk: "Spis (L2)", en: "Matter (L2)" },
    L3: { cz: "Právo (L3)", sk: "Právo (L3)", en: "Law (L3)" },
  };
  const lines: string[] = [
    "---",
    `okf_version: "${OKF_VERSION}"`,
    "---",
    "",
    `# ${j === "en" ? "Memory index" : j === "cz" ? "Rejstřík paměti" : "Register pamäte"}`,
    "",
    j === "en" ? "> Generated. Do not edit manually; this file is regenerated." : j === "cz"
      ? "> Generováno. Needituj ručně — přepíše se."
      : "> Generované. Needituj ručne — prepíše sa.",
  ];
  for (const layer of ["L2", "L1", "L3"] as const) {
    const vo = [...scope.records].filter((r) => r.layer === layer).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (vo.length === 0) continue;
    lines.push("", `## ${nadpis[layer]?.[j] ?? layer}`, "");
    for (const r of vo) {
      const cesta = href(r.id);
      const odkaz = cesta ? `[${r.id}](${cesta})` : r.id;
      lines.push(`* ${odkaz} — ${documentTypeLabel(r.type, j)} — ${r.description}`);
    }
  }
  // Starý `INDEX.md` sa musí zmazať PRED zápisom, nie po ňom.
  //
  // macOS je case-insensitive: `existsSync("INDEX.md")` vráti true aj na
  // práve zapísaný `index.md` a mazanie po zápise by nový súbor zlikvidovalo.
  // Zápis do `index.md` navyše na takom systéme prepíše obsah existujúceho
  // `INDEX.md`, ale **ponechá starý názov** — premenovanie sa teda musí urobiť
  // zmazaním. Presný názov berieme z `readdirSync`, ktorý vracia uloženú
  // podobu, nie tú, na ktorú sme sa pýtali.
  if (readdirSync(store.memoryDir).includes(LEGACY_INDEX_FILE)) {
    rmSync(join(store.memoryDir, LEGACY_INDEX_FILE), { force: true });
  }
  writeProjection(join(store.memoryDir, INDEX_FILE), lines.join("\n") + "\n", dir);
}

/**
 * `log.md` — chronológia bundle podľa OKF: zoskupené podľa dátumu ISO 8601,
 * najnovšie hore.
 *
 * Nie je to druhý zdroj pravdy. Generuje sa z `## History` jednotlivých
 * záznamov, takže sa s nimi nemôže rozísť.
 */
export function writeLog(dir: string): void {
  preflightBundleProjections(dir);
  const scope = completeScope(dir);
  const store = scope.matter;
  if (!existsSync(store.memoryDir)) return;
  const j = renderLanguage(documentLanguageFromCard(dir), store.jurisdiction);
  const href = scopeLinkResolver(dir, true);

  const podlaDatumu = new Map<string, string[]>();
  for (const r of scope.records) {
    for (const e of r.timeline) {
      const cesta = href(r.id);
      const odkaz = cesta ? `[${r.id}](${cesta})` : r.id;
      const druh = e.kind ? `**${documentValueLabel("event_kind", e.kind, j)}**: ` : "";
      const zoznam = podlaDatumu.get(e.date) ?? [];
      zoznam.push(`* ${druh}${e.text} — ${odkaz}`);
      podlaDatumu.set(e.date, zoznam);
    }
  }

  const lines: string[] = [`# ${j === "en" ? "Matter history" : j === "cz" ? "Historie spisu" : "História spisu"}`, ""];
  for (const datum of [...podlaDatumu.keys()].sort().reverse()) {
    lines.push(`## ${datum}`, "", ...(podlaDatumu.get(datum) ?? []), "");
  }
  writeProjection(join(store.memoryDir, LOG_FILE), lines.join("\n"), dir);
}

/** Vstupný bod pre agentov. Nikdy neprepíše existujúci — je to ľudský súbor. */
export function ensureBrain(dir: string, j: Jurisdiction): void {
  const path = join(dir, BRAIN_FILE);
  if (existsSync(path)) return;
  const language = renderLanguage(documentLanguageFromCard(dir), j);
  const mem = MEMORY_DIR;
  const cz = [
    "# BRAIN.md — protokol paměti spisu",
    "",
    "Vstupní bod pro agenty. Načti úplný kontext paměti, pak originály podle úkolu.",
    "",
    "1. `matter.md` (dříve `spis.md`) — karta věci",
    `2. \`${STATUS_FILE}\` — **Fáze** a **Další krok** nahoře; tabulky mezi markery generuje paměť`,
    "3. `okf-memory read <spis>` — celý obsah všech typů záznamů věci, klienta a kanceláře včetně revizí",
    "4. `VSTUPY.md` — nezpracované vstupy pending; chyby čtení a neúplnost předej dál",
    "5. `memory/index.md` — pomocná mapa, nenahrazuje úplný kontext",
    "",
    "## Zápisová disciplína",
    "",
    "- Každý záznam má sekci **Truth** (aktuální stav) a **History** (append-only).",
    "- Změna Truth i věcných metadat musí přidat řádek do History a aktualizovat updated.",
    "- Před úpravou uchovej Revision ID: sha256 z read; write vyžaduje --if-revision. Při konfliktu načti nový stav a slaď změny, nevyměňuj jen token.",
    "- Neúplné čtení vrací chybu; sync nesmí přepsat projekce. Chybějící generated ani strojové verified nepotvrzuje lhůtu člověkem.",
    "- Do L2 (spis) zapisuje agent sám. Do **L1** (pravidla, poučení) a **L3** (právní prameny)",
    "  a při **mazání** jen člověk — nástroj bez schválení zápis odmítne.",
    `- \`${STATUS_FILE}\` mimo markery patří advokátovi. Needituj to.`,
    "",
    "## Tři úrovně paměti",
    "",
    `- \`${mem}/\` zde ve spisu — obsah věci (L2)`,
    "- `memory/` u nalezeného klienta — společné subjekty a prověření",
    `- \`${OFFICE_DIR}/memory/\` — pravidla a poučení (L1) a právní prameny (L3)`,
    "",
    "Pramen patří kanceláři, ne spisu: jinak se týž judikát zkopíruje do deseti",
    "spisů a kontrola úniku běží desetkrát nad týmž textem.",
    "",
    "## Jediná paměť věci",
    "",
    `Tento adresář (\`${mem}/\`) je **jediné** místo, kam se paměť zapisuje.`,
    "Najdeš-li ve spisu `_memory.md`, `lrd.json`, `progress.txt`, `LEARNINGS.md`",
    "nebo adresáře `facts/`, `research/`, `strategy/` ze starších nástrojů —",
    "**staré záznamy paměti čti jako archiv.** Originály a aktuální rešerše zůstávají pracovními podklady. Dvě paměti v jednom spisu",
    "znamenají dvě pravdy a jedna z nich bude tiše zastaralá.",
    "",
  ];
  const sk = [
    "# BRAIN.md — protokol pamäte spisu",
    "",
    "Vstupný bod pre agentov. Načítaj úplný kontext pamäte, potom originály podľa úlohy.",
    "",
    "1. `matter.md` (predtým `spis.md`) — karta veci",
    `2. \`${STATUS_FILE}\` — **Fáza** a **Ďalší krok** hore; tabuľky medzi markermi generuje pamäť`,
    "3. `okf-memory read <spis>` — celý obsah všetkých typov záznamov veci, klienta a kancelárie vrátane revízií",
    "4. `VSTUPY.md` — nespracované vstupy pending; chyby čítania a neúplnosť odovzdaj ďalej",
    "5. `memory/index.md` — pomocná mapa, nenahrádza úplný kontext",
    "",
    "## Zápisová disciplína",
    "",
    "- Každý záznam má sekciu **Truth** (aktuálny stav) a **History** (append-only).",
    "- Zmena Truth aj vecných metadát musí pridať riadok do History a aktualizovať updated.",
    "- Pred úpravou uchovaj Revision ID: sha256 z read; write vyžaduje --if-revision. Pri konflikte načítaj nový stav a zosúlaď zmeny, nevymieňaj iba token.",
    "- Neúplné čítanie vracia chybu; sync nesmie prepísať projekcie. Chýbajúce generated ani strojové verified nepotvrdzuje lehotu človekom.",
    "- Do L2 (spis) zapisuje agent sám. Do **L1** (pravidlá, poučenia) a **L3** (právne pramene)",
    "  a pri **mazaní** iba človek — nástroj bez schválenia zápis odmietne.",
    `- \`${STATUS_FILE}\` mimo markerov patrí advokátovi. Needituj to.`,
    "",
    "## Tri úrovne pamäte",
    "",
    `- \`${mem}/\` tu v spise — obsah veci (L2)`,
    "- `memory/` u nájdeného klienta — spoločné subjekty a preverenia",
    `- \`${OFFICE_DIR}/memory/\` — pravidlá a poučenia (L1) a právne pramene (L3)`,
    "",
    "Prameň patrí kancelárii, nie spisu: inak sa ten istý judikát skopíruje do",
    "desiatich spisov a kontrola úniku beží desaťkrát nad tým istým textom.",
    "",
    "## Jediná pamäť veci",
    "",
    `Tento adresár (\`${mem}/\`) je **jediné** miesto, kam sa pamäť zapisuje.`,
    "Ak nájdeš v spise `_memory.md`, `lrd.json`, `progress.txt`, `LEARNINGS.md`",
    "alebo adresáre `facts/`, `research/`, `strategy/` zo starších nástrojov —",
    "**staré záznamy pamäte čítaj ako archív.** Originály a aktuálne rešerše zostávajú pracovnými podkladmi. Dve pamäte v jednom spise",
    "znamenajú dve pravdy a jedna z nich bude ticho zastaraná.",
    "",
  ];
  const en = [
    "# BRAIN.md — matter memory protocol", "",
    "Entry point for agents. Read the complete memory context, then original sources relevant to the task.", "",
    "1. `matter.md` (formerly `spis.md`) — matter card",
    `2. \`${STATUS_FILE}\` — **Phase** and **Next step** at the top; memory generates tables between markers`,
    "3. `okf-memory read <matter>` — full records for the matter, client and office, including revision tokens",
    "4. `VSTUPY.md` — pending inputs; report incomplete reads and errors",
    "5. `memory/index.md` — navigation only, never a substitute for complete context", "",
    "## Write discipline", "",
    "- Each record has **Truth** (current state) and **History** (append-only).",
    "- Changes to Truth or substantive metadata must append History and update updated.",
    "- Before editing, retain the Revision ID: sha256 from read; write requires --if-revision. On conflict, read again and reconcile the content, not just the token.",
    "- Incomplete reads fail; sync must not overwrite projections. Missing generated or machine verified metadata does not establish human confirmation of a deadline.",
    "- Agents may write L2 (matter). **L1** (rules and lessons), **L3** (legal authorities), and **deletions** require human approval; the tool rejects unapproved writes.",
    `- Content outside markers in \`${STATUS_FILE}\` belongs to the lawyer. Do not edit it.`, "",
    "## Three memory layers", "",
    `- \`${mem}/\` in this matter — matter content (L2)`,
    "- `memory/` in the identified client directory — shared subjects and screening",
    `- \`${OFFICE_DIR}/memory/\` — rules and lessons (L1), legal authorities (L3)`, "",
    "Legal authorities belong to the office, not individual matters; copying them across matters creates duplicates and repeated leak checks.", "",
    "## One matter memory", "",
    `This directory (\`${mem}/\`) is the **only** destination for memory writes.`,
    "Treat legacy `_memory.md`, `lrd.json`, `progress.txt`, `LEARNINGS.md`, or `facts/`, `research/`, `strategy/` memory records as an archive.",
    "Original documents and current research remain working sources. Two memory stores create two competing versions of the matter.", "",
  ];
  writeFileSync(path, (language === "en" ? en : language === "cz" ? cz : sk).join("\n"), "utf8");
}

/** Premietne pamäť do blokov _STATUS.md. Mimo markerov nemení nič. */
export function syncStatus(dir: string): void {
  assertProjectionFile(join(dir, STATUS_FILE), dir);
  const scope = completeScope(dir);
  const store = scope.matter;
  const path = join(dir, STATUS_FILE);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const next = renderStatus(existing, scope.records, store.jurisdiction, statusLinkResolver(dir), documentLanguageFromCard(dir));
  if (next !== existing) writeProjection(path, next, dir);
}

/** Retrofit markerov do existujúceho `_STATUS.md`. Vráti, ktoré bloky pribudli. */
export function retrofitStatusFile(dir: string, apply: boolean): BlockName[] {
  if (apply) assertProjectionFile(join(dir, STATUS_FILE), dir);
  const store = readStore(dir);
  const path = join(dir, STATUS_FILE);
  if (!existsSync(path)) return [];
  const existing = readFileSync(path, "utf8");
  const { text, inserted } = retrofitStatus(existing, store.records, store.jurisdiction, linkResolver(store, false), documentLanguageFromCard(dir));
  if (apply && inserted.length > 0) writeProjection(path, text, dir);
  return inserted;
}

/**
 * Rozsah pamäte, ktorý agent pri práci na spise vidí.
 *
 * AML identifikácia sa podľa § 8 robí raz pri vzniku obchodného vzťahu
 * a podľa § 16 sa archivuje 10 rokov od jeho skončenia — nie od skončenia
 * kauzy. Preto subjekty a preverenia žijú u klienta a spis na ne odkazuje.
 */
export interface Scope {
  readonly matter: Store;
  readonly clientDir: string | undefined;
  readonly clientRecords: OkfRecord[];
  readonly officeDir: string | undefined;
  readonly officeRecords: OkfRecord[];
  /** Spisové aj klientske záznamy dohromady — nad týmto beží validácia. */
  readonly records: OkfRecord[];
  readonly problems: StoreProblem[];
}

/**
 * Karta klienta. `client.md` je kanonická; `klient.md` sa uznáva dovtedy,
 * kým nedobehne migrácia existujúcich spisov — dovtedy by inak prestali
 * fungovať priečinky založené skriptami `novy-spis`.
 */
const CLIENT_CARDS = ["client.md", "klient.md"];

/**
 * Zložka kancelárie. Býva v koreni spisov vedľa priečinkov klientov a drží
 * to, čo je nadspisové: pravidlá a poučenia (L1) a právne pramene (L3).
 *
 * Prameň patrí sem, nie do spisu — inak sa ten istý judikát skopíruje do
 * desiatich spisov a kontrola úniku beží desaťkrát nad tým istým textom.
 */
/**
 * Priečinok kancelárie. Rozhodnutie z callu 11. 9. 2026: jazykovo neutrálne
 * `Office` — strojová vrstva je po anglicky, obsah zápisov v jazyku advokáta.
 * Starší `_kancelaria` sa ďalej rozpozná; nový sa zakladá už len ako `Office`.
 */
export const OFFICE_DIR = "Office";
export const LEGACY_OFFICE_DIR = "_kancelaria";
const OFFICE_DIRS = [OFFICE_DIR, LEGACY_OFFICE_DIR] as const;

/**
 * Nájde zložku kancelárie nad spisom alebo klientom.
 *
 * Rozloženie Fázy A je `AK/<písmeno>/<klient>/Spisy/<vec>` — spis leží päť
 * úrovní pod koreňom vaultu. S piatimi krokmi sa kancelária nenašla a zápis
 * prameňa skončil potichu v spise (test 10 vecí z ISIR, 11. 9. 2026). Osem
 * krokov nechá rezervu pre ďalšiu úroveň, ale nedôjde až ku koreňu disku,
 * kde by cudzí priečinok `Office` vyzeral ako kancelária.
 */
export function findOfficeDir(startDir: string, maxUp = 8): string | undefined {
  let dir = resolve(startDir);
  // Z kancelárie samotnej je kanceláriou ona sama. Inak by zápis L1 priamo
  // do kancelárie nikdy nedostal trvalé poverenie — konfig leží práve tam.
  if (OFFICE_DIRS.some((n) => basename(dir) === n)) return dir;
  for (let i = 0; i < maxUp; i++) {
    const candidate = OFFICE_DIRS.map((n) => join(dir, n)).find((c) => existsSync(c));
    if (candidate) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/**
 * Nájde zložku klienta nad spisom. MČ profil A má medzi nimi ešte úroveň
 * oblasti práva, preto sa hľadá viac než jednu úroveň vyššie.
 */
export function findClientDir(matterDir: string, maxUp = Number.POSITIVE_INFINITY): string | undefined {
  let dir = resolve(matterDir);
  for (let i = 0; i < maxUp; i++) {
    const parent = dirname(dir);
    if (parent === dir) break;
    if (CLIENT_CARDS.some((c) => existsSync(join(parent, c)))) return parent;
    dir = parent;
  }
  // Karta nie je — skús vzor z konfigu kancelárie. Poradie je dôležité:
  // karta v priečinku je konkrétnejšia než vzor pre celý vault a musí vyhrať.
  return findClientByPath(matterDir, maxUp);
}

/**
 * Nájde priečinok klienta podľa `client_path` v `Office/okf.config`.
 * Koreňom je rodič `Office/` (alebo staršej `_kancelaria/`), teda koreň vaultu.
 *
 * Bez tohto by v cudzom vaulte klientská úroveň nevznikla vôbec — a s ňou by
 * zmizli AML subjekty **aj z dosahu brány úniku**, ktorá `readScope` používa.
 * Tichý dôsledok chýbajúcej karty by teda nebol nepohodlie, ale slepá brána.
 */
function findClientByPath(matterDir: string, maxUp: number): string | undefined {
  const officeDir = findOfficeDir(matterDir);
  if (!officeDir) return undefined;
  const pattern = readClientPath(officeDir);
  if (!pattern) return undefined;

  const root = dirname(officeDir);
  let dir = resolve(matterDir);
  for (let i = 0; i < maxUp; i++) {
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    const rel = relative(root, parent);
    if (rel !== "" && !rel.startsWith("..") && matchesClientPath(rel, pattern)) return parent;
    dir = parent;
  }
  return undefined;
}

export function readScope(matterDir: string): Scope {
  const matter = readStore(matterDir);
  const clientDir = findClientDir(matterDir);
  const client = clientDir ? readStore(clientDir) : undefined;
  const clientRecords = client?.records ?? [];
  // Kancelária ako „spis" nesmie čítať samu seba dvakrát.
  const najdena = findOfficeDir(matterDir);
  const officeDir = najdena && resolve(najdena) !== resolve(matterDir) ? najdena : undefined;
  const office = officeDir ? readStore(officeDir) : undefined;
  const officeRecords = office?.records ?? [];
  const records = [...matter.records, ...clientRecords, ...officeRecords];
  const problems = [...matter.problems, ...(client?.problems ?? []), ...(office?.problems ?? [])];
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) problems.push({ file: matterDir, message: `Duplicitné ID ${record.id} v rozsahu pamäte.` });
    seen.add(record.id);
  }
  return {
    matter,
    clientDir,
    clientRecords,
    officeDir,
    officeRecords,
    records,
    problems,
  };
}


/** Rovnaké pravidlo ako v projekcii: markdown odkaz, alebo holý identifikátor. */
function odkazNaZaznam(id: string, href: LinkResolver): string {
  const cesta = href(id);
  return cesta ? `[${id}](${cesta})` : id;
}
