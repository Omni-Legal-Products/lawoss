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
import { join } from "node:path";
import { parseRecord, serializeRecord, type OkfRecord } from "./record.ts";
import { renderStatus } from "./render.ts";
import { authorize, type Approval, type WriteDiff } from "./write.ts";
import type { Jurisdiction } from "./schema.ts";

const INDEX_FILE = "INDEX.md";
const BRAIN_FILE = "BRAIN.md";
const STATUS_FILE = "_STATUS.md";

export function memoryDirName(j: Jurisdiction): string {
  return j === "cz" ? "pamet" : "pamat";
}

export interface Store {
  readonly dir: string;
  readonly jurisdiction: Jurisdiction;
  readonly memoryDir: string;
  readonly records: OkfRecord[];
}

function detect(dir: string): Jurisdiction | undefined {
  if (existsSync(join(dir, memoryDirName("cz")))) return "cz";
  if (existsSync(join(dir, memoryDirName("sk")))) return "sk";
  return undefined;
}

export function readStore(dir: string): Store {
  const j = detect(dir) ?? "cz";
  const memoryDir = join(dir, memoryDirName(j));
  const records: OkfRecord[] = [];
  if (existsSync(memoryDir)) {
    for (const name of readdirSync(memoryDir).sort()) {
      if (!name.endsWith(".md") || name === INDEX_FILE) continue;
      records.push(parseRecord(readFileSync(join(memoryDir, name), "utf8")));
    }
  }
  return { dir, jurisdiction: j, memoryDir, records };
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

/** Zapíše návrh na disk — najprv však prejde bránou. */
export function applyRecordWrite(dir: string, diff: WriteDiff, approval: Approval | undefined): void {
  authorize(diff, approval);
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
  const head = j === "cz" ? "| Záznam | Typ | Vrstva | Popis |" : "| Záznam | Typ | Vrstva | Popis |";
  const rows = [...store.records]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((r) => `| [[${r.id}]] | ${r.type} | ${r.layer} | ${r.summary} |`);
  const body = [`# ${title}`, "", note, "", head, "|---|---|---|---|", ...rows, ""].join("\n");
  writeFileSync(join(store.memoryDir, INDEX_FILE), body, "utf8");
}

/** Vstupný bod pre agentov. Nikdy neprepíše existujúci — je to ľudský súbor. */
export function ensureBrain(dir: string, j: Jurisdiction): void {
  const path = join(dir, BRAIN_FILE);
  if (existsSync(path)) return;
  const mem = memoryDirName(j);
  const cz = [
    "# BRAIN.md — protokol paměti spisu",
    "",
    "Vstupní bod pro agenty. Čti v tomto pořadí, dál jen cíleně přes odkazy.",
    "",
    "1. `spis.md` — karta věci",
    `2. \`${STATUS_FILE}\` — **Fáze** a **Další krok** nahoře; tabulky mezi markery generuje paměť`,
    `3. \`${mem}/${INDEX_FILE}\` — rejstřík paměti, odtud na konkrétní záznam`,
    "",
    "## Zápisová disciplína",
    "",
    "- Každý záznam má sekci **Pravda** (aktuální stav) a **Historie** (append-only).",
    "- Změna Pravdy musí ve stejném zápisu přidat řádek do Historie. Nástroj to vynucuje.",
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
    "1. `spis.md` — karta veci",
    `2. \`${STATUS_FILE}\` — **Fáza** a **Ďalší krok** hore; tabuľky medzi markermi generuje pamäť`,
    `3. \`${mem}/${INDEX_FILE}\` — register pamäte, odtiaľ na konkrétny záznam`,
    "",
    "## Zápisová disciplína",
    "",
    "- Každý záznam má sekciu **Pravda** (aktuálny stav) a **História** (append-only).",
    "- Zmena Pravdy musí v tom istom zápise pridať riadok do Histórie. Nástroj to vynucuje.",
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
