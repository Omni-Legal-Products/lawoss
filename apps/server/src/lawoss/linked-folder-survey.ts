/**
 * LAWOSS: prieskum priečinka pred pripojením ku klientovi (alfa2 A3, N-16; rozhodnutie MČ 22. 10. 2026).
 *
 * - Tvrdé odmietnutie, keď priečinok nesie značky OKF iného klienta alebo kancelárie: `client.md`/`klient.md`
 *   v ňom alebo v jeho predkovi (patrí klientovi), v podpriečinku do hĺbky 2 (obsahuje klientov, napr.
 *   `Klienti/C001/client.md`), `okf.config` v ňom, v jeho `Office/`/`_kancelaria/`, v takom priečinku priameho
 *   podpriečinka alebo predka (prax).
 * - Mäkké potvrdenie, keď priečinok len vyzerá ako prax: aspoň dva priame podpriečinky, z ktorých každý má aspoň
 *   dva podpriečinky pomenované ako veci (kód `M049 …`, `SYN-0001`, rok na začiatku, spisová značka). Právna
 *   forma sama nie je signál: priečinky protistrán ju nesú tiež.
 *
 * Prieskum je ohraničený (jedna úroveň obsahu podpriečinkov, limit položiek), nesleduje symbolické odkazy a beží
 * len pri natívnom zápise nového priečinka, nie pri každom zostavení mapy. Chýbajúci priečinok nič nenájde. Keď
 * prieskum nedobehne (limit, nečitateľný podpriečinok), nepovolí potichu: vráti aspoň mäkké `practice_like`.
 * `Office`/`_kancelaria` sa porovnáva bez ohľadu na veľkosť písmen.
 */
import { lstat, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isPathWithin } from "./path-within.js";

export type LinkedFolderSurvey = { kind: "practice" | "other_client" } | { kind: "practice_like"; clients: string[] } | null;

const CLIENT_CARDS = ["client.md", "klient.md"];
const OFFICE_DIRS = new Set(["office", "_kancelaria"]);
const LIMIT = { children: 1000, grandchildren: 2000, ancestors: 32, clients: 5, nestedCards: 4000 };

/** Kód veci alebo klienta na začiatku názvu: `M049 …`, `C001-syn-…`, `SYN-0001`. */
const CODE = /^[A-Z]{1,3}[-_]?\d{2,}(?![\p{L}\d])/u;
/** Rok na začiatku a niečo za ním („2024-03 Žaloba“), nie holý dátum archívu („2024“, „2024-01“). */
const YEAR_PREFIX = /^20\d{2}(?:[-_. ](?:0[1-9]|1[0-2]))?[-_ ]+\p{L}/u;
/** Spisová značka v názve („5Cb 12/2024“, „12 C 345/2023“). */
const CASE_NUMBER = /(?:^|\s)\d{1,3}\s?\p{L}{1,4}\s?\d{1,6}\/\d{2,4}(?:$|\s)/u;
const looksLikeMatter = (name: string): boolean => CODE.test(name) || YEAR_PREFIX.test(name) || CASE_NUMBER.test(name);
const isOfficeName = (name: string): boolean => OFFICE_DIRS.has(name.toLowerCase());

const isFile = (path: string): Promise<boolean> => lstat(path).then((entry) => entry.isFile(), () => false);
const hasClientCard = async (folder: string): Promise<boolean> => (await Promise.all(CLIENT_CARDS.map((name) => isFile(join(folder, name))))).some(Boolean);
/** Kancelária v predkovi (bez výpisu priečinka): `okf.config` v ňom alebo v jeho `Office/`/`office/`/`_kancelaria/`. */
const ancestorHasOffice = async (folder: string): Promise<boolean> =>
  (await Promise.all(["okf.config", "Office/okf.config", "office/okf.config", "_kancelaria/okf.config"].map((name) => isFile(join(folder, name))))).some(Boolean);

type Entry = { name: string; directory: boolean; file: boolean };
type Listing = { entries: Entry[]; incomplete: boolean };
/** Obsah priečinka bez skrytých položiek; `incomplete` pri limite alebo chybe čítania (chýbajúci priečinok je prázdny). */
async function listing(folder: string, limit: number): Promise<Listing> {
  try {
    const visible = (await readdir(folder, { withFileTypes: true })).filter((entry) => !entry.name.startsWith("."));
    return { entries: visible.slice(0, limit).map((entry) => ({ name: entry.name, directory: entry.isDirectory(), file: entry.isFile() })), incomplete: visible.length > limit };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    return { entries: [], incomplete: code !== "ENOENT" && code !== "ENOTDIR" };
  }
}

/** Kancelária priamo v priečinku podľa jeho výpisu: `okf.config` v ňom alebo v podpriečinku `Office`/`_kancelaria`. */
async function officeIn(folder: string, entries: readonly Entry[]): Promise<boolean> {
  if (entries.some((entry) => entry.file && entry.name.toLowerCase() === "okf.config")) return true;
  for (const entry of entries) if (entry.directory && isOfficeName(entry.name) && await isFile(join(folder, entry.name, "okf.config"))) return true;
  return false;
}

/** Predkovia priečinka bez koreňa disku (kanonická cesta). */
function ancestors(folder: string): string[] {
  const result: string[] = [];
  for (let current = dirname(folder); current !== dirname(current) && result.length < LIMIT.ancestors; current = dirname(current)) result.push(current);
  return result;
}

/**
 * @param folder kanonická absolútna cesta nového priečinka
 * @param ownRoot kanonický koreň klienta, ku ktorému sa pripája (jeho pamäť kancelárie a predkovia sa neposudzujú)
 */
export async function surveyLinkedFolder(folder: string, ownRoot: string | null): Promise<LinkedFolderSurvey> {
  // Predok s kartou klienta: priečinok patrí (aj nezaregistrovanému) klientovi. Predkovia vlastného klienta nie.
  const foreignAncestors = ancestors(folder).filter((ancestor) => !ownRoot || !isPathWithin(ancestor, ownRoot));
  for (const ancestor of foreignAncestors) if (await hasClientCard(ancestor)) return { kind: "other_client" };
  if (await hasClientCard(folder)) return { kind: "other_client" };
  // Pamäť kancelárie vlastnej praxe (`<prax>/Office` vedľa `<prax>/Klienti/<klient>` alebo `<prax>/<klient>`) sa
  // pripája aj bez profilu praxe. Vyššie položený `Office` (napr. `~/Office`) výnimku nemá.
  if (ownRoot !== null && isOfficeName(basename(folder)) && [dirname(ownRoot), dirname(dirname(ownRoot))].includes(dirname(folder))) return null;
  const top = await listing(folder, LIMIT.children);
  if (await officeIn(folder, top.entries)) return { kind: "practice" };
  // Predok s kanceláriou: priečinok leží v praxi (aj keď nie je v profile), aj v praxi vlastného klienta.
  for (const ancestor of ancestors(folder)) if (await ancestorHasOffice(ancestor)) return { kind: "practice" };

  const clients: string[] = [];
  let incomplete = top.incomplete;
  let nestedCards = LIMIT.nestedCards;
  for (const child of top.entries.filter((entry) => entry.directory)) {
    const path = join(folder, child.name);
    const inside = await listing(path, LIMIT.grandchildren);
    incomplete ||= inside.incomplete;
    // Obsahuje klienta (jeho kartu): ako priečinok, ktorý obsahuje registrovaného klienta.
    if (inside.entries.some((entry) => entry.file && CLIENT_CARDS.includes(entry.name.toLowerCase()))) return { kind: "other_client" };
    if (await officeIn(path, inside.entries)) return { kind: "practice" };
    for (const grandchild of inside.entries.filter((entry) => entry.directory)) {
      if (nestedCards-- <= 0) { incomplete = true; break; }
      if (await hasClientCard(join(path, grandchild.name))) return { kind: "other_client" };
    }
    if (inside.entries.filter((entry) => entry.directory && looksLikeMatter(entry.name)).length >= 2) clients.push(child.name);
  }
  const names = clients.sort((a, b) => a.localeCompare(b)).slice(0, LIMIT.clients);
  return clients.length >= 2 || incomplete ? { kind: "practice_like", clients: names } : null;
}
