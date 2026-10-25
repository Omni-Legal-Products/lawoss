/**
 * N-A5-6 (test 25. 10. 2026): titulok okna („C002-syn-hron-technologie-a-s · Prehľad“) a bočný panel počas
 * načítavania („C024-syn-tomas-sve…“) ukazovali meno priečinka klienta, nie meno z jeho karty (client.md). Nové
 * registrácie berú meno z karty už pri zápise (server `registrationName`); priestory zaregistrované skôr nie.
 *
 * Len na zobrazenie: keď prehľad pozná meno z karty, appka si ho zapamätá (v tomto počítači, podľa priestoru a jeho
 * priečinka) a `workspaceLabel`/`mapDesktopWorkspace` ho ukážu namiesto mena priečinka, aj pri ďalšom štarte ešte
 * pred načítaním prehľadu. Meno priestoru na serveri sa nemení (export dokumentov ho používa ako identitu) a meno,
 * ktoré si advokát zvolil (zobrazované meno alebo iné než priečinok), ostáva.
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
  return title && title.length <= 200 && !/^[>|[{&*!'"]/.test(title) && !title.includes("{{") ? title : undefined;
}

const folderName = (path: string): string => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
const same = (a: string, b: string): boolean => a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();
const namedLikeFolder = (workspace: Workspace): boolean => {
  const name = workspace.name?.trim() ?? "";
  return !workspace.displayName?.trim() && Boolean(workspace.path) && (!name || same(name, folderName(workspace.path ?? "")));
};

/** Priestory klientov pomenované ako ich priečinok a meno z karty klienta pre ne. */
export function cardTitles(workspaces: readonly Workspace[], scope: OkfScope | null, clients: readonly Pick<OkfClient, "path" | "title">[]): { id: string; path: string; title: string }[] {
  if (!scope) return [];
  const byFolder = new Map(clients.flatMap((client) => {
    const title = client.title ? cleanTitle(client.title) : undefined;
    const folder = title ? overviewFolder(scope, client.path) : null;
    return folder && title ? [[folder, title] as const] : [];
  }));
  return workspaces.flatMap((workspace) => {
    if (workspace.workspaceType === "remote" || !workspace.path || !namedLikeFolder(workspace)) return [];
    const title = byFolder.get(comparable(workspace.path));
    return title && !same(title, workspace.name ?? "") ? [{ id: workspace.id, path: workspace.path, title }] : [];
  });
}

/** Zapamätá mená z karty (prepíše staré pri tom istom priestore); zapíše len pri zmene. */
export function rememberCardTitles(entries: readonly { id: string; path: string; title: string }[]): void {
  const current = load();
  let changed = false;
  for (const entry of entries) {
    const known = current[entry.id];
    if (known?.path === entry.path && known.title === entry.title) continue;
    current[entry.id] = { path: entry.path, title: entry.title };
    changed = true;
  }
  if (changed) { try { storage()?.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* bez úložiska len do konca behu */ } }
}

/** Meno z karty klienta namiesto mena priečinka; `undefined`, keď priestor má vlastné meno alebo karta nie je známa. */
export function clientCardLabel(workspace: Workspace): string | undefined {
  if (!namedLikeFolder(workspace)) return undefined;
  const known = load()[workspace.id];
  return known && known.path === workspace.path ? known.title : undefined;
}

/** Len pre testy: zabudne načítané mená (nový štart appky). */
export function resetCardTitlesForTest(): void { titles = null; }
