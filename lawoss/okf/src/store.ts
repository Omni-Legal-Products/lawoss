/**
 * Vrstva, ktorá sa dotýka disku.
 *
 * Jediná cesta k zápisu vedie cez applyRecordWrite → authorize. Ak brána
 * odmietne, na disku nevznikne nič — kontrola je pred zápisom, nie po ňom.
 *
 * Jadro sa dotýka výhradne troch vecí: adresára pamäte, BRAIN.md a blokov
 * v _STATUS.md. Dokumenty spisu ani karty nikdy neotvára na zápis.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseRecord, serializeRecord, type OkfRecord } from "./record.ts";
import { renderStatus } from "./render.ts";
import { validateStore } from "./validate.ts";
import { authorize, type Approval, type WriteDiff } from "./write.ts";
import { typeLabel, type Jurisdiction } from "./schema.ts";

const INDEX_FILE = "INDEX.md";
const BRAIN_FILE = "BRAIN.md";
const STATUS_FILE = "_STATUS.md";

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

export function readStore(dir: string): Store {
  const memoryDir = join(dir, MEMORY_DIR);
  const records: OkfRecord[] = [];
  const problems: StoreProblem[] = [];
  if (existsSync(memoryDir)) {
    for (const name of readdirSync(memoryDir).sort()) {
      if (!name.endsWith(".md") || name === INDEX_FILE) continue;
      try {
        records.push(parseRecord(readFileSync(join(memoryDir, name), "utf8")));
      } catch (e) {
        problems.push({ file: name, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  // Jurisdikcia slúži už len na lokalizáciu výstupu. Berie sa zo záznamov;
  // prázdny spis ju má na karte veci, inak sa predpokladá česká.
  const j = records[0]?.jurisdiction ?? jurisdictionFromCard(dir) ?? "cz";
  return { dir, jurisdiction: j, memoryDir, records, problems };
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
  return join(store.memoryDir, existing ?? `${r.id}-${slug(r.title)}.md`);
}

export class LeakBlockedError extends Error {}

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
  const ostatne = readScope(dir).records.filter((r) => r.id !== after.id);
  const chyby = validateStore([...ostatne, after]).filter(
    (f) => f.recordId === after.id && f.severity === "error" && f.code === "L3_LEAK",
  );
  if (chyby.length === 0) return;
  throw new LeakBlockedError(
    `Zápis záznamu ${after.id} odmietnutý — ${chyby.map((f) => f.message).join(" ")}`,
  );
}

/** Zapíše návrh na disk — najprv však prejde bránami. */
export function applyRecordWrite(dir: string, diff: WriteDiff, approval: Approval | undefined): void {
  authorize(diff, approval);
  if (diff.after) assertNoLeak(dir, diff.after);
  const store = readStore(dir);
  if (!existsSync(store.memoryDir)) mkdirSync(store.memoryDir, { recursive: true });

  if (diff.kind === "delete") {
    if (diff.before) rmSync(fileFor(store, diff.before), { force: true });
    return;
  }
  const after = diff.after;
  if (!after) throw new Error(`Návrh ${diff.kind} nemá nový stav záznamu`);
  writeFileSync(fileFor(store, after), serializeRecord(after), "utf8");
}

export function writeIndex(dir: string): void {
  const store = readStore(dir);
  if (!existsSync(store.memoryDir)) return;
  const j = store.jurisdiction;
  const title = j === "cz" ? "Rejstřík paměti" : "Register pamäte";
  const note =
    j === "cz"
      ? "> Generováno. Needituj ručně — přepíše se."
      : "> Generované. Needituj ručne — prepíše sa.";
  const head = "| Záznam | Typ | Vrstva | Popis |";
  const rows = [...store.records]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((r) => `| [[${r.id}]] | ${typeLabel(r.type, j)} | ${r.layer} | ${r.summary} |`);
  const body = [`# ${title}`, "", note, "", head, "|---|---|---|---|", ...rows, ""].join("\n");
  writeFileSync(join(store.memoryDir, INDEX_FILE), body, "utf8");
}

/** Vstupný bod pre agentov. Nikdy neprepíše existujúci — je to ľudský súbor. */
export function ensureBrain(dir: string, j: Jurisdiction): void {
  const path = join(dir, BRAIN_FILE);
  if (existsSync(path)) return;
  const mem = MEMORY_DIR;
  const cz = [
    "# BRAIN.md — protokol paměti spisu",
    "",
    "Vstupní bod pro agenty. Čti v tomto pořadí, dál jen cíleně přes odkazy.",
    "",
    "1. `matter.md` (dříve `spis.md`) — karta věci",
    `2. \`${STATUS_FILE}\` — **Fáze** a **Další krok** nahoře; tabulky mezi markery generuje paměť`,
    `3. \`${mem}/${INDEX_FILE}\` — rejstřík paměti, odtud na konkrétní záznam`,
    "",
    "## Zápisová disciplína",
    "",
    "- Každý záznam má sekci **Truth** (aktuální stav) a **History** (append-only).",
    "- Změna Truth musí ve stejném zápisu přidat řádek do History. Nástroj to vynucuje.",
    "- Do L2 (spis) zapisuje agent sám. Do **L1** (pravidla, poučení) a **L3** (právní prameny)",
    "  a při **mazání** jen člověk — nástroj bez schválení zápis odmítne.",
    `- \`${STATUS_FILE}\` mimo markery patří advokátovi. Needituj to.`,
    "",
  ];
  const sk = [
    "# BRAIN.md — protokol pamäte spisu",
    "",
    "Vstupný bod pre agentov. Čítaj v tomto poradí, ďalej len cielene cez odkazy.",
    "",
    "1. `matter.md` (predtým `spis.md`) — karta veci",
    `2. \`${STATUS_FILE}\` — **Fáza** a **Ďalší krok** hore; tabuľky medzi markermi generuje pamäť`,
    `3. \`${mem}/${INDEX_FILE}\` — register pamäte, odtiaľ na konkrétny záznam`,
    "",
    "## Zápisová disciplína",
    "",
    "- Každý záznam má sekciu **Truth** (aktuálny stav) a **History** (append-only).",
    "- Zmena Truth musí v tom istom zápise pridať riadok do History. Nástroj to vynucuje.",
    "- Do L2 (spis) zapisuje agent sám. Do **L1** (pravidlá, poučenia) a **L3** (právne pramene)",
    "  a pri **mazaní** iba človek — nástroj bez schválenia zápis odmietne.",
    `- \`${STATUS_FILE}\` mimo markerov patrí advokátovi. Needituj to.`,
    "",
  ];
  writeFileSync(path, (j === "cz" ? cz : sk).join("\n"), "utf8");
}

/** Premietne pamäť do blokov _STATUS.md. Mimo markerov nemení nič. */
export function syncStatus(dir: string): void {
  const store = readStore(dir);
  const path = join(dir, STATUS_FILE);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const next = renderStatus(existing, store.records, store.jurisdiction);
  if (next !== existing) writeFileSync(path, next, "utf8");
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
 * Nájde zložku klienta nad spisom. MČ profil A má medzi nimi ešte úroveň
 * oblasti práva, preto sa hľadá viac než jednu úroveň vyššie.
 */
export function findClientDir(matterDir: string, maxUp = 4): string | undefined {
  let dir = resolve(matterDir);
  for (let i = 0; i < maxUp; i++) {
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    if (CLIENT_CARDS.some((c) => existsSync(join(parent, c)))) return parent;
    dir = parent;
  }
  return undefined;
}

export function readScope(matterDir: string): Scope {
  const matter = readStore(matterDir);
  const clientDir = findClientDir(matterDir);
  const client = clientDir ? readStore(clientDir) : undefined;
  const clientRecords = client?.records ?? [];
  return {
    matter,
    clientDir,
    clientRecords,
    records: [...matter.records, ...clientRecords],
    problems: [...matter.problems, ...(client?.problems ?? [])],
  };
}
