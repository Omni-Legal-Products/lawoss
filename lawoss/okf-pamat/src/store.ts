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
import { dirname, join, relative, resolve } from "node:path";
import { parseRecord, serializeRecord, type OkfRecord } from "./record.ts";
import { renderStatus } from "./render.ts";
import { validateStore } from "./validate.ts";
import { authorize, type Approval, type WriteDiff } from "./write.ts";
import { readStandingAuthorization, covers, readClientPath, matchesClientPath } from "./config.ts";
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
export class ConcurrentWriteError extends Error {}

/**
 * Optimistická kontrola súbehu. `updated` slúži ako verzia: keď sa záznam
 * na disku medzitým posunul, zápis z prekonaného východiska sa odmietne.
 *
 * Append-only história konflikt zmierňuje — dva zápisy sa dajú zliať —
 * ale `## Truth` je last-write-wins a tichá strata cudzej práce je presne
 * to, čo advokát zistí až vtedy, keď je neskoro.
 */
function assertNotStale(store: Store, diff: WriteDiff): void {
  const before = diff.before;
  if (!before) return;
  const naDisku = store.records.find((r) => r.id === before.id);
  if (!naDisku || naDisku.updated === before.updated) return;
  throw new ConcurrentWriteError(
    `Záznam ${before.id} sa medzitým zmenil: vychádzaš zo stavu ${before.updated}, ` +
      `na disku je ${naDisku.updated}. Načítaj ho znova a zápis zopakuj.`,
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
/**
 * Schválenie plynúce z trvalého poverenia advokáta v `_kancelaria/okf.config`.
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

export function applyRecordWrite(dir: string, diff: WriteDiff, approval: Approval | undefined): void {
  authorize(diff, approval ?? standingApproval(dir, diff));
  if (diff.after) assertNoLeak(dir, diff.after);
  const store = readStore(dir);
  assertNotStale(store, diff);
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
    "## Tři úrovně paměti",
    "",
    `- \`${mem}/\` zde ve spisu — obsah věci (L2)`,
    "- `../../memory/` u klienta — subjekty a AML prověření (identifikace se dělá jednou)",
    "- `_kancelaria/memory/` — pravidla a poučení (L1) a právní prameny (L3)",
    "",
    "Pramen patří kanceláři, ne spisu: jinak se týž judikát zkopíruje do deseti",
    "spisů a kontrola úniku běží desetkrát nad týmž textem.",
    "",
    "## Jediná paměť věci",
    "",
    `Tento adresář (\`${mem}/\`) je **jediné** místo, kam se paměť zapisuje.`,
    "Najdeš-li ve spisu `_memory.md`, `lrd.json`, `progress.txt`, `LEARNINGS.md`",
    "nebo adresáře `facts/`, `research/`, `strategy/` ze starších nástrojů —",
    "**čti je jako archiv, ale nezapisuj do nich.** Dvě paměti v jednom spisu",
    "znamenají dvě pravdy a jedna z nich bude tiše zastaralá.",
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
    "## Tri úrovne pamäte",
    "",
    `- \`${mem}/\` tu v spise — obsah veci (L2)`,
    "- `../../memory/` u klienta — subjekty a AML preverenia (identifikácia sa robí raz)",
    "- `_kancelaria/memory/` — pravidlá a poučenia (L1) a právne pramene (L3)",
    "",
    "Prameň patrí kancelárii, nie spisu: inak sa ten istý judikát skopíruje do",
    "desiatich spisov a kontrola úniku beží desaťkrát nad tým istým textom.",
    "",
    "## Jediná pamäť veci",
    "",
    `Tento adresár (\`${mem}/\`) je **jediné** miesto, kam sa pamäť zapisuje.`,
    "Ak nájdeš v spise `_memory.md`, `lrd.json`, `progress.txt`, `LEARNINGS.md`",
    "alebo adresáre `facts/`, `research/`, `strategy/` zo starších nástrojov —",
    "**čítaj ich ako archív, ale nezapisuj do nich.** Dve pamäte v jednom spise",
    "znamenajú dve pravdy a jedna z nich bude ticho zastaraná.",
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
export const OFFICE_DIR = "_kancelaria";

/** Nájde zložku kancelárie nad spisom alebo klientom. */
export function findOfficeDir(startDir: string, maxUp = 5): string | undefined {
  let dir = resolve(startDir);
  if (dir.endsWith(`/${OFFICE_DIR}`)) return undefined;
  for (let i = 0; i < maxUp; i++) {
    const candidate = join(dir, OFFICE_DIR);
    if (existsSync(candidate)) return candidate;
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
export function findClientDir(matterDir: string, maxUp = 4): string | undefined {
  let dir = resolve(matterDir);
  for (let i = 0; i < maxUp; i++) {
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    if (CLIENT_CARDS.some((c) => existsSync(join(parent, c)))) return parent;
    dir = parent;
  }
  // Karta nie je — skús vzor z konfigu kancelárie. Poradie je dôležité:
  // karta v priečinku je konkrétnejšia než vzor pre celý vault a musí vyhrať.
  return findClientByPath(matterDir, maxUp);
}

/**
 * Nájde priečinok klienta podľa `client_path` v `_kancelaria/okf.config`.
 * Koreňom je rodič `_kancelaria/`, teda koreň vaultu.
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
  const officeDir = findOfficeDir(matterDir);
  const office = officeDir ? readStore(officeDir) : undefined;
  const officeRecords = office?.records ?? [];
  return {
    matter,
    clientDir,
    clientRecords,
    officeDir,
    officeRecords,
    records: [...matter.records, ...clientRecords, ...officeRecords],
    problems: [...matter.problems, ...(client?.problems ?? []), ...(office?.problems ?? [])],
  };
}
