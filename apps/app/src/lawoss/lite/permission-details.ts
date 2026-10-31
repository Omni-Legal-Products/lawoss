/**
 * N-A8-3 (regresia 30. 10. 2026): „Podrobnosti“ na karte „Upraviť súbory?“ ukazovali surový JSON `{ "filepath": …, "diff": … }`
 * a na karte „Pristúpiť k externému priečinku?“ `{ "filepath": …, "parentDir": … }`. Advokát pred schválením nevidel
 * čitateľne, čo sa zmení. Pre tieto dve otázky enginu sú Podrobnosti zoznam riadkov: súbor (pri úprave voči priečinku
 * klienta, ak v ňom leží) a pridané/odobraté riadky zmeny, pri externom priečinku priečinok a súbor s popisom.
 * Iné otázky ostanú pri doterajšom zobrazení. Iba zobrazenie, o prístupe nerozhoduje.
 */
import { t } from "@/i18n";
import type { PendingPermission } from "@/app/types";
import type { FileOperationDetails } from "./file-operation-card";
import { overviewFolder } from "./client-projects";
import { useClientNav } from "./client-nav";
import { comparable, within } from "./matter-conversations";

/** Najviac toľko riadkov zmeny; zvyšok jedným riadkom „… a ďalšie“. */
const MAX_LINES = 200;
/** Hlavička zjednoteného diffu enginu (`Index:`, `===`, `---`, `+++`, `@@`) a značka bez nového riadku: nie sú to riadky zmeny. */
const DIFF_HEADER = /^(?:Index: |={3,}|--- |\+\+\+ |@@ |\\ No newline)/;

const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const segments = (path: string): string[] => path.normalize("NFC").replace(/\\/g, "/").split("/").filter(Boolean);

/** Cesta súboru voči priečinku klienta, ak v ňom leží; inak celá cesta. */
export function clientRelativePath(path: string, clientFolder: string | null | undefined): string {
  if (!clientFolder || !within(comparable(clientFolder), comparable(path)) || comparable(clientFolder) === comparable(path)) return path;
  return segments(path).slice(segments(clientFolder).length).join("/");
}

/** Pridané a odobraté riadky zmeny (`+ text`, `- text`); kontext a hlavičky diffu sa vynechajú. */
export function changeLines(diff: string): string[] {
  const changed = diff.split(/\r?\n/).filter((line) => !DIFF_HEADER.test(line) && /^[+-]/.test(line))
    .map((line) => `${line[0]} ${line.slice(1).replace(/^ (?=\S)/, "")}`);
  if (changed.length <= MAX_LINES) return changed;
  return [...changed.slice(0, MAX_LINES), t("lawoss.permission_details.more_lines", undefined, { count: String(changed.length - MAX_LINES) })];
}

/** Čitateľné Podrobnosti pre `edit` a `external_directory`; iná otázka alebo chýbajúca cesta `null` (ostane doterajšie zobrazenie). */
export function permissionDetails(permission: Pick<PendingPermission, "permission" | "metadata">, clientFolder?: string | null): FileOperationDetails | null {
  const metadata = permission.metadata && typeof permission.metadata === "object" ? permission.metadata : {};
  const file = text(metadata.filepath) ?? text(metadata.filePath);
  if (permission.permission === "edit" && file) {
    const diff = text(metadata.diff);
    const change = diff ? changeLines(diff) : [];
    return { reason: null, lines: [
      t("lawoss.permission_details.file", undefined, { path: clientRelativePath(file, clientFolder) }),
      ...(change.length ? [t("lawoss.permission_details.change"), ...change] : [t("lawoss.permission_details.no_change")]),
    ] };
  }
  if (permission.permission === "external_directory") {
    const folder = text(metadata.parentDir);
    if (!folder && !file) return null;
    return { reason: null, lines: [
      ...(folder ? [t("lawoss.permission_details.external_folder", undefined, { path: folder })] : []),
      ...(file ? [t("lawoss.permission_details.external_file", undefined, { path: file })] : []),
    ] };
  }
  return null;
}

/** Priečinok klienta chatu z prehľadu bočného panela (najhlbší klient s kartou, v ktorom chat leží); inak priečinok chatu. */
function useClientFolder(chatDirectory: string | null | undefined): string | null {
  const nav = useClientNav();
  if (!chatDirectory?.trim()) return null;
  const scope = nav?.scope;
  const chat = comparable(chatDirectory);
  const folders = scope ? (nav?.data?.clients ?? []).flatMap((client) => {
    const folder = overviewFolder(scope, client.path);
    return folder && within(folder, chat) ? [folder] : [];
  }) : [];
  return folders.sort((a, b) => b.length - a.length)[0] ?? chatDirectory;
}

/** Podrobnosti karty: vlastné (`lawoss_files`), inak pre `edit` a `external_directory`; inak `null` (surové údaje ako doteraz). */
export function usePermissionDetails(permission: Pick<PendingPermission, "permission" | "metadata">, chatDirectory?: string | null, own?: FileOperationDetails): FileOperationDetails | null {
  const clientFolder = useClientFolder(chatDirectory);
  return own ?? permissionDetails(permission, clientFolder);
}
