/**
 * N-A5-6 (test 25. 10. 2026): titulok okna („C002-syn-hron-technologie-a-s · Prehľad“) a bočný panel počas
 * načítavania („C024-syn-tomas-sve…“) ukazovali meno priečinka klienta, nie meno z jeho karty (client.md). Nové
 * registrácie berú meno z karty už pri zápise (server `registrationName`); priestory zaregistrované skôr nie.
 *
 * Len na zobrazenie: keď prehľad pozná meno z karty, appka si ho zapamätá (v tomto počítači, podľa priestoru a jeho
 * priečinka) a riadok bočného panela (`clientRowFrom`), z ktorého berie meno aj titulok okna, ho ukáže ešte pred
 * načítaním prehľadu. Meno priestoru (server, exporty, premenovanie) sa nemení; meno, ktoré si advokát zvolil, ostáva.
 */
import type { OkfClient, OkfScope } from "../okf/read-model";
import { overviewFolder } from "./client-projects";
import { comparable } from "./matter-conversations";

type Workspace = { id: string; path?: string | null; name?: string | null; displayName?: string | null; workspaceType?: string };
type Remembered = { path: string; title: string };

const STORAGE_KEY = "lawoss.clientCardTitles.v1";
let titles: Record<string, Remembered> | null = null;

function storage(): Pick<Storage, "getItem" | "setItem"> | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function load(): Record<string, Remembered> {
  if (titles) return titles;
  titles = {};
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "{}");
    if (parsed && typeof parsed === "object") {
      for (const [id, value] of Object.entries(parsed)) {
        const path: unknown = value && typeof value === "object" ? Reflect.get(value, "path") : undefined;
        const title: unknown = value && typeof value === "object" ? Reflect.get(value, "title") : undefined;
        if (typeof path === "string" && typeof title === "string" && cleanTitle(title) === title) titles[id] = { path, title };
      }
    }
  } catch { /* poškodený záznam: mená z priečinkov, kým sa prehľad nenačíta */ }
  return titles;
}

/** Meno z karty, ako ho číta server (`cardTitleFromMarkdown`): bez riadiacich znakov, šablóny ani nadmernej dĺžky. */
export function cleanTitle(raw: string): string | undefined {
  const title = raw.replace(/[\s\p{Cc}]+/gu, " ").trim();
  // Úvodzovky okolo mena odstráni už čítanie karty (rovnako ho ukáže aj načítaný riadok).
  return title && title.length <= 200 && !/^[>|[{&*!]/.test(title) && !title.includes("{{") ? title : undefined;
}

const folderName = (path: string): string => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
const same = (a: string, b: string): boolean => a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();
const namedLikeFolder = (workspace: Workspace): boolean => {
  const name = workspace.name?.trim() ?? "";
  return !workspace.displayName?.trim() && Boolean(workspace.path) && (!name || same(name, folderName(workspace.path ?? "")));
};

/**
 * Priestory klientov pomenované ako ich priečinok a meno z karty klienta pre ne. `title: null` = karta mena už nemá
 * (alebo sa volá ako priečinok): zapamätané meno sa zabudne, ale len po úplnom čítaní bez problémov (karta, ktorá
 * sa práve nedala prečítať, meno nezmaže). Klient, ktorého prehľad nepozná, sa nemení.
 */
export function cardTitles(workspaces: readonly Workspace[], scope: OkfScope | null, clients: readonly Pick<OkfClient, "path" | "title">[], complete = true): { id: string; path: string; title: string | null }[] {
  if (!scope) return [];
  const byFolder = new Map(clients.flatMap((client) => {
    const folder = overviewFolder(scope, client.path);
    return folder ? [[folder, client.title ? cleanTitle(client.title) ?? null : null] as const] : [];
  }));
  return workspaces.flatMap((workspace) => {
    if (workspace.workspaceType === "remote" || !workspace.path || !namedLikeFolder(workspace)) return [];
    const key = comparable(workspace.path);
    if (!byFolder.has(key)) return [];
    const title = byFolder.get(key) ?? null;
    const shown = title && !same(title, workspace.name ?? "") ? title : null;
    return shown || complete ? [{ id: workspace.id, path: workspace.path, title: shown }] : [];
  });
}

/**
 * Zapamätá mená z karty (prepíše staré pri tom istom priestore, `null` ho zabudne); zapíše len pri zmene. `live`:
 * všetky priestory appky, záznamy odstránených priestorov sa zahodia.
 */
export function rememberCardTitles(entries: readonly { id: string; path: string; title: string | null }[], live?: readonly string[]): void {
  const current = load();
  let changed = false;
  if (live) {
    const ids = new Set(live);
    for (const id of Object.keys(current)) if (!ids.has(id)) { delete current[id]; changed = true; }
  }
  for (const entry of entries) {
    const known = current[entry.id];
    if (entry.title === null) {
      if (known) { delete current[entry.id]; changed = true; }
      continue;
    }
    if (known?.path === entry.path && known.title === entry.title) continue;
    current[entry.id] = { path: entry.path, title: entry.title };
    changed = true;
  }
  if (changed) { try { storage()?.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* bez úložiska len do konca behu */ } }
}

/**
 * Zapamätané meno z karty pre riadok, ktorý ešte nemá fakty z prehľadu; `undefined`, keď natívne meno už nie je meno
 * zapamätaného priečinka (advokát priestor premenoval) alebo priestor je v inom priečinku (`path`, ak je známa).
 */
export function clientCardLabel(workspaceId: string, nativeLabel: string, path?: string | null): string | undefined {
  const known = load()[workspaceId];
  if (!known || !same(nativeLabel.trim(), folderName(known.path))) return undefined;
  return path && comparable(path) !== comparable(known.path) ? undefined : known.title;
}

/** Len pre testy: zabudne načítané mená (nový štart appky). */
export function resetCardTitlesForTest(): void { titles = null; }
