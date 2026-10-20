/**
 * Pripojené priečinky klienta (rozhodnutie MČ 19. 10. 2026): klient má jeden hlavný priečinok (tam je OKF)
 * a k nemu pripojené ďalšie, ktoré agent smie čítať. Nie je to nový sklad: zoznam je natívny zoznam
 * „povolených priečinkov“ projektu klienta (`permission.external_directory`, Nastavenia → Oprávnenia),
 * čítaný a zapisovaný cez `listAuthorizedFolders` / `setAuthorizedFolders`.
 *
 * Čistý model bez Reactu: čo sa smie pripojiť (porovnanie bez rozdielu NFC/NFD z macOS), ktoré položky
 * spravuje LAWOSS (pamäť kancelárie z onboardingu) a kedy nastavenie zamkla firma.
 * Natívny mechanizmus má jedinú úroveň („allow“): agent priečinok číta a súbory v ňom upravuje podľa
 * globálnych oprávnení nástrojov. Úroveň „len čítanie“ v ňom nie je. Engine ich dostane len v chatoch
 * tohto klienta (plugin `lawoss-linked-folders` na serveri); server zápis kontroluje znova kanonicky.
 */
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { normalizeAuthorizedFolderPath } from "@/react-app/domains/settings/panels/authorized-folders-panel-state";
import { comparable, within } from "./matter-conversations";

export type LinkRefusal = "own" | "contains_client" | "other_client" | "practice_root" | "missing" | "duplicate";

/** Statické kľúče textov (audit nepovoľuje skladanie kľúča za behu). */
export const LINK_REFUSAL_TEXT = {
  own: "lawoss.lite.linked_folders_refuse_own",
  contains_client: "lawoss.lite.linked_folders_refuse_contains_client",
  other_client: "lawoss.lite.linked_folders_refuse_other_client",
  practice_root: "lawoss.lite.linked_folders_refuse_practice_root",
  missing: "lawoss.lite.linked_folders_refuse_missing",
  duplicate: "lawoss.lite.linked_folders_refuse_duplicate",
} as const satisfies Record<LinkRefusal, string>;

/** Odmietnutie servera (natívny zápis, kanonické cesty) ako dôvod pre ten istý text. */
export function serverRefusal(error: unknown): LinkRefusal | null {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return code === "linked_folder_other_client" ? "other_client" : code === "linked_folder_practice" ? "practice_root" : null;
}

export type LinkScope = {
  /** Hlavný priečinok klienta (registrovaný projekt). */
  clientRoot: string;
  /** Koreň praxe z profilu, ak je. */
  practiceRoot: string | null;
  /** Priečinky ostatných klientov (registrovaní aj z prehľadu praxe). */
  otherClients: readonly string[];
  /** Už pripojené priečinky (natívny zoznam, v pôvodnom tvare). */
  linked: readonly string[];
};

const isAbsolute = (path: string): boolean => path.startsWith("/") || /^[A-Za-z]:\//.test(path);
const comparableFolder = (path: string | null | undefined): string => {
  const normalized = normalizeAuthorizedFolderPath(path);
  return normalized ? comparable(normalized) : "";
};

/** Prečo sa priečinok nepripojí; `null` = smie sa pripojiť. */
export function linkRefusal(candidate: string | null | undefined, scope: LinkScope): LinkRefusal | null {
  const raw = normalizeAuthorizedFolderPath(candidate);
  if (!raw || !isAbsolute(raw)) return "missing";
  const folder = comparable(raw);
  const own = comparableFolder(scope.clientRoot);
  // Vlastný priečinok klienta a všetko v ňom agent v chate klienta číta aj bez pripojenia.
  if (own && within(own, folder)) return "own";
  const practice = comparableFolder(scope.practiceRoot);
  // Koreň praxe alebo priečinok nad ním by otvoril všetkých klientov naraz.
  if (practice && within(folder, practice)) return "practice_root";
  // Iný klient: jeho priečinok, niečo v ňom, alebo priečinok, ktorý ho obsahuje (únik medzi klientmi).
  if (scope.otherClients.some((other) => {
    const dir = comparableFolder(other);
    return Boolean(dir) && (within(dir, folder) || within(folder, dir));
  })) return "other_client";
  if (own && within(folder, own)) return "contains_client";
  // Priečinky praxe sa nepripájajú (okrem pamäte kancelárie); server to isté overí s vyriešenými cestami.
  if (practice && within(practice, folder) && !isOfficeGrant(raw, scope.practiceRoot)) return "practice_root";
  if (scope.linked.some((entry) => comparableFolder(entry) === folder)) return "duplicate";
  return null;
}

type Workspace = { path?: string | null; workspaceType?: string | null };

/**
 * Priečinky ostatných klientov: registrované lokálne projekty a priečinky klientov z prehľadu praxe,
 * bez tých, ktoré obsahujú tohto klienta (koreň praxe) alebo ležia v ňom (staršia vec registrovaná zvlášť).
 */
export function otherClientFolders(clientRoot: string, workspaces: readonly Workspace[], groupFolders: readonly string[]): string[] {
  const own = comparableFolder(clientRoot);
  const candidates = [
    ...workspaces.flatMap((w) => w.workspaceType !== "remote" && w.path ? [w.path] : []),
    ...groupFolders,
  ];
  const seen = new Set<string>();
  return candidates.filter((path) => {
    const dir = comparableFolder(path);
    if (!dir || !own || within(dir, own) || within(own, dir) || seen.has(dir)) return false;
    seen.add(dir);
    return true;
  });
}

const OFFICE_FOLDERS = new Set(["office", "_kancelaria"]);

/** Pamäť kancelárie, ktorú pri založení klienta pripojil onboarding (`Office/` alebo `_kancelaria/` praxe). */
export function isOfficeGrant(folder: string, practiceRoot: string | null): boolean {
  const root = comparableFolder(practiceRoot);
  const dir = comparableFolder(folder);
  if (!root || !dir) return false;
  const name = dir.slice(dir.lastIndexOf("/") + 1).toLowerCase();
  if (!OFFICE_FOLDERS.has(name)) return false;
  const parent = dir.slice(0, dir.lastIndexOf("/")) || "/";
  return parent === root;
}

export type LinkedFolderRow = { path: string; name: string; managed: boolean };

const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() || path;

export function linkedFolderRows(folders: readonly string[], practiceRoot: string | null): LinkedFolderRow[] {
  return folders.map((path) => ({ path, name: folderName(path), managed: isOfficeGrant(path, practiceRoot) }));
}

/** Počet pod klientom v paneli: priečinky, ktoré pripojil človek (bez pamäte kancelárie). */
export function linkedFolderCount(folders: readonly string[], practiceRoot: string | null): number {
  return linkedFolderRows(folders, practiceRoot).filter((row) => !row.managed).length;
}

type FirmEntry = { locked?: boolean; value: Record<string, unknown> } | null | undefined;

/** Ako natívny panel: firma spravuje priečinky, ak jej oprávnenia určujú `external_directory`; zamknuté len so zámkom. */
export function linkedFoldersPolicy(entry: FirmEntry): { managed: boolean; locked: boolean } {
  const managed = entry?.value.external_directory !== undefined;
  return { managed, locked: managed && entry?.locked === true };
}

export type SaveResult = "saved" | "declined";
export type LinkResult = { kind: "cancelled" } | { kind: "refused"; reason: LinkRefusal } | { kind: SaveResult };

/**
 * Pripojenie: výber priečinka, čerstvý natívny zoznam (súbežná zmena inde sa nestratí), kontrola a uloženie
 * celého zoznamu s novou položkou. Cesta ide v tvare z disku (natívna normalizácia, bez NFC).
 */
export async function linkFolder(deps: {
  pick: () => Promise<string | null>;
  scope: Omit<LinkScope, "linked">;
  current: () => Promise<readonly string[]>;
  save: (folders: string[]) => Promise<SaveResult>;
}): Promise<LinkResult> {
  const picked = await deps.pick();
  if (picked === null) return { kind: "cancelled" };
  const linked = await deps.current();
  const reason = linkRefusal(picked, { ...deps.scope, linked });
  if (reason) return { kind: "refused", reason };
  return { kind: await deps.save([...linked, normalizeAuthorizedFolderPath(picked)]) };
}

/** Odpojenie: čerstvý natívny zoznam bez priečinka; ostatné položky ostanú v pôvodnom tvare. */
export async function unlinkFolder(current: () => Promise<readonly string[]>, folder: string, save: (folders: string[]) => Promise<SaveResult>): Promise<SaveResult> {
  return save((await current()).filter((entry) => entry !== folder));
}

/**
 * Zápis cez natívny zoznam projektu klienta. Keď priečinky mimo projektu spravuje firma, ide cez natívne
 * prevzatie nastavenia (ako panel v Nastaveniach); zamknuté alebo odmietnuté = „declined“, nič sa nezapíše.
 */
export function linkedFoldersWriter(deps: {
  client: Pick<LegalworkServerClient, "listAuthorizedFolders" | "setAuthorizedFolders">;
  workspaceId: string;
  managed: boolean;
  changePolicy: (write: () => Promise<void>) => Promise<boolean>;
}) {
  return {
    current: async (): Promise<readonly string[]> => (await deps.client.listAuthorizedFolders(deps.workspaceId)).folders,
    save: async (folders: string[]): Promise<SaveResult> => {
      const write = async () => { await deps.client.setAuthorizedFolders(deps.workspaceId, folders); };
      if (!deps.managed) {
        await write();
        return "saved";
      }
      return (await deps.changePolicy(write)) ? "saved" : "declined";
    },
  };
}
