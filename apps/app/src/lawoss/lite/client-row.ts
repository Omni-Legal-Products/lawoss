/**
 * Riadky klientov, prípadov a chatov v bočnom paneli (alfa2 B3, N-22). Čistý model bez Reactu:
 * - čitateľné meno klienta z karty `client.md`/`klient.md` (OKF read model), inak upravené meno priečinka;
 *   meno, ktoré používateľ zadal sám (premenovanie projektu), ostáva;
 * - stručný stav riadku: len to, čo je v súboroch (najbližšia lehota, stav veci); chýbajúce = nič, nikdy „žiadne“;
 * - kontext chatu (Klient · Prípad) podľa priečinka chatu;
 * - bežný režim: krátky zoznam položiek pod klientom, ostatné pod „Viac“; rozbalený je jeden klient (accordion).
 */
import { isOfficeFile, type MatterOverview } from "../../../../../lawoss/okf/read";
import type { OkfReadResult, OkfScope } from "../okf/read-model";
import { urgencyOf, type Urgency } from "../okf/view-rules";
import { overviewFolder } from "./client-projects";
import { comparable, within } from "./matter-conversations";
import { nextDeadline } from "./today-model";
import type { UiMode } from "./ui-mode";

/** Posledný segment cesty (meno priečinka) bez koncových lomiek. */
export function folderName(path: string | null | undefined): string {
  const parts = (path ?? "").split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/**
 * Meno priečinka ako text pre človeka: `C001-syn-tatran-automatika-s-r-o` → `C001 syn tatran automatika s r o`.
 * Meno s medzerami ostáva (už je čitateľné). Kód klienta na začiatku sa nezahadzuje, advokát ním klienta hľadá.
 */
export function prettyFolderName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || /\s/.test(trimmed)) return trimmed;
  return trimmed.replace(/[-_.]+/g, " ").replace(/\s+/g, " ").trim() || trimmed;
}

type Group = { key: string; matters: readonly Pick<MatterOverview, "path">[] };
type NavData = Pick<OkfReadResult, "clients" | "inputs">;

/** Priečinok klienta z kľúča skupiny s kartou (`client:<cesta>`); iné skupiny kartu nemajú. */
const cardFolder = (key: string): string | null => key.startsWith("client:") ? key.slice("client:".length) : null;

/**
 * Skupina klienta, ktorého priečinok je presne priečinok projektu (registrovaný klient). Koreň praxe s viacerými
 * klientmi nie je žiadny z nich, preto vlastníctvo (`ownerOf`) nestačí.
 */
export function clientGroupOfProject<G extends Group>(scope: OkfScope | null, groups: readonly G[], projectPath: string | null | undefined): G | null {
  if (!scope || !projectPath) return null;
  const root = comparable(projectPath);
  return groups.find((g) => {
    const folder = cardFolder(g.key);
    return folder !== null && overviewFolder(scope, folder) === root;
  }) ?? null;
}

/** Názov z karty klienta (`title`); bez karty alebo bez názvu `undefined` (nie meno priečinka). */
export function cardTitle(data: NavData | undefined, groupKey: string): string | undefined {
  const folder = cardFolder(groupKey);
  if (folder === null || !data) return undefined;
  const fromCard = data.clients?.find((c) => c.path === folder)?.title?.trim();
  if (fromCard) return fromCard;
  return data.inputs.find((i) => i.clientTitle?.trim() && (i.scopePaths ?? []).includes(folder))?.clientTitle?.trim();
}

export type ClientLabel = { label: string; /** Technické meno priečinka a cesta do bublinky. */ folder?: string; path?: string };

/**
 * Meno klienta v rozhraní. Poradie: meno zadané používateľom (natívne meno iné než meno priečinka) → názov z karty
 * klienta → upravené meno priečinka. Projekt, ktorý nie je klient, má natívne meno bez zmeny.
 */
export function clientLabel(input: { nativeLabel: string; path?: string | null; isClient: boolean; cardTitle?: string }): ClientLabel {
  const folder = folderName(input.path);
  const path = input.path ?? undefined;
  if (!input.isClient || !folder) return { label: input.nativeLabel };
  const native = input.nativeLabel.trim();
  if (native && native !== folder && native !== input.path?.trim()) return { label: native, folder, path };
  return { label: input.cardTitle?.trim() || prettyFolderName(folder), folder, path };
}

/** Stav lehoty v riadku: po lehote, dátum na overenie, alebo najbližšia lehota (dnes a neskôr). */
export type RowDeadline =
  | { kind: "overdue"; urgency: "hot" }
  | { kind: "invalid"; urgency: "hot" }
  | { kind: "next"; date: string; urgency: Urgency };

/**
 * Najbližšia relevantná lehota zo súborov (bez lehôt kancelárie, ako bod naliehavosti): zmeškaná lehota a dátum na
 * overenie majú prednosť pred ďalšou lehotou. Žiadna lehota = `null` (riadok nič netvrdí).
 */
export function rowDeadline(deadlines: readonly { date: string; invalid?: true; file?: string }[], todayIso: string): RowDeadline | null {
  const own = deadlines.filter((d) => !isOfficeFile(d.file));
  if (own.some((d) => !d.invalid && d.date < todayIso)) return { kind: "overdue", urgency: "hot" };
  if (own.some((d) => d.invalid)) return { kind: "invalid", urgency: "hot" };
  const next = nextDeadline(own, todayIso);
  return next ? { kind: "next", date: next, urgency: urgencyOf(next, todayIso) } : null;
}

/**
 * Lehota v riadku klienta: len pri úplnom čítaní (pri neúplnom by „najbližšia“ mohla klamať) a len keď nejaká je.
 */
export function clientRowDeadline(matters: readonly Pick<MatterOverview, "deadlines">[], complete: boolean, todayIso: string): RowDeadline | null {
  if (!complete) return null;
  return rowDeadline(matters.flatMap((m) => m.deadlines), todayIso);
}

/** Vec, v ktorej priečinku je chat (najhlbšia); chat mimo vecí `null`. */
export function matterOfDirectory<M extends Pick<MatterOverview, "path" | "title">>(scope: OkfScope | null, matters: readonly M[], directory: string | null | undefined): M | null {
  if (!scope || !directory) return null;
  const dir = comparable(directory);
  let best: { matter: M; length: number } | null = null;
  for (const matter of matters) {
    const folder = overviewFolder(scope, matter.path);
    if (folder && within(folder, dir) && (!best || folder.length > best.length)) best = { matter, length: folder.length };
  }
  return best?.matter ?? null;
}

/** Klient (skupina s kartou alebo tvarom cesty), v ktorého priečinku chat je (najhlbší); inak `null`. */
export function groupOfDirectory<G extends Group>(scope: OkfScope | null, groups: readonly G[], directory: string | null | undefined, folderOf: (group: G) => string | null): G | null {
  if (!scope || !directory) return null;
  const dir = comparable(directory);
  let best: { group: G; length: number } | null = null;
  for (const group of groups) {
    const folder = folderOf(group);
    const abs = folder === null ? null : comparable(folder);
    if (abs && within(abs, dir) && (!best || abs.length > best.length)) best = { group, length: abs.length };
  }
  return best?.group ?? null;
}

/** Položky pod klientom v bežnom režime: Prehľad, Prípady, Chaty, Súbory, Pripojené priečinky. */
const LITE_MAIN = ["projectHome", "projectMatters", "projectSessions", "projectFiles", "projectLinkedFolders"] as const;
const isLiteMain = (key: string): boolean => LITE_MAIN.some((k) => k === key);

/**
 * Rozdelenie položiek projektu: Pokročilý režim natívne (všetko v natívnom poradí, bez „Viac“); bežný režim krátky
 * zoznam v pevnom poradí a ostatné zapnuté položky (aj Pracovný priestor) pod „Viac“. Vypnuté položky ostanú vypnuté.
 */
export function liteProjectNav<K extends string>(items: readonly K[], mode: UiMode): { lite: boolean; main: K[]; more: K[] } {
  if (mode !== "lite") return { lite: false, main: [...items], more: [] };
  const main = LITE_MAIN.flatMap((key) => items.filter((item) => item === key));
  return { lite: true, main, more: items.filter((item) => !isLiteMain(item)) };
}

/**
 * Rozbalení klienti po akcii. Bežný režim: accordion (rozbalený je jeden, ostatní kompaktne); Pokročilý natívne
 * (viac naraz). Nezmenená množina sa vráti tá istá (bez zbytočného prekreslenia).
 */
export function expandedAfter(previous: Set<string>, id: string, mode: UiMode, action: "expand" | "toggle"): Set<string> {
  const open = previous.has(id);
  if (action === "expand" && open && (mode !== "lite" || previous.size === 1)) return previous;
  if (open && action === "toggle") {
    const next = new Set(previous);
    next.delete(id);
    return next;
  }
  if (mode === "lite") return new Set([id]);
  const next = new Set(previous);
  next.add(id);
  return next;
}

