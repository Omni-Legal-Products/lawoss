/** @jsxImportSource react */
/**
 * N-A8-3 (regresia 30. 10. 2026): „Podrobnosti“ na karte „Upraviť súbory?“ ukazovali surový JSON `{ "filepath": …, "diff": … }`
 * a na karte „Pristúpiť k externému priečinku?“ `{ "filepath": …, "parentDir": … }`. Advokát pred schválením nevidel
 * čitateľne, čo sa zmení. Pre tieto dve otázky enginu sú Podrobnosti zoznam riadkov: súbor (pri úprave voči priečinku
 * klienta, ak v ňom leží) a pridané/odobraté riadky zmeny, pri externom priečinku priečinok a súbor s popisom.
 * Iné otázky ostanú pri doterajšom zobrazení. Iba zobrazenie, o prístupe nerozhoduje.
 *
 * Blok „Kontrola“ v dialógu (rozhodnutie MČ 31. 10. 2026) ukazoval surový diff s hlavičkami `Index:`, `---`, `+++`, `@@`.
 * Teraz tie isté riadky zmeny ako Podrobnosti (`changeLines`), pridané zelené, odobraté červené a prečiarknuté, a súbor
 * voči priečinku klienta. Ostatné riadky bloku ostanú.
 */
import type { ReactNode } from "react";
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

/** Riadky zmeny s farbou: pridané zelené, odobraté červené a prečiarknuté (ako sledované zmeny); znak `+`/`-` ostáva pre čítanie bez farby. */
export function ChangeLineList({ lines }: { lines: string[] }) {
  return <span className="block space-y-0.5 font-sans" data-lawoss-change-lines="">
    {lines.map((line, index) => {
      const mark = line[0] === "+" ? "added" : line[0] === "-" ? "removed" : null;
      const tone = mark === "added" ? "rounded bg-green-3/40 px-1 text-green-11"
        : mark === "removed" ? "rounded bg-red-3/40 px-1 text-red-11 line-through decoration-red-11/60" : "text-dls-secondary";
      return <span key={index} className={`block ${tone}`} data-change={mark ?? "more"}>{line}</span>;
    })}
  </span>;
}

type ReviewRow = { label: string; value: string; multiline?: boolean };

/** Riadky bloku „Kontrola“: súbor voči priečinku klienta a zmena bez hlavičiek diffu s farbou; ostatné riadky bez zmeny. */
export function readableReviewRows<R extends ReviewRow>(rows: R[], clientFolder?: string | null): Array<Omit<R, "value"> & { value: ReactNode }> {
  const fileLabel = t("session.permission_detail_file");
  const diffLabel = t("session.permission_detail_diff");
  return rows.map((row) => {
    if (row.label === fileLabel) return { ...row, value: clientRelativePath(row.value, clientFolder) };
    if (row.label !== diffLabel) return row;
    const change = changeLines(row.value);
    return { ...row, label: t("lawoss.permission_review.change"), value: change.length ? <ChangeLineList lines={change} /> : t("lawoss.permission_details.no_change") };
  });
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

/** Háčik pre blok „Kontrola“ v dialógu: riadky upstream `permissionDetailRows` prepíše čitateľne (`readableReviewRows`). */
export function useReviewRows<R extends ReviewRow>(rows: R[], chatDirectory?: string | null) {
  return readableReviewRows(rows, useClientFolder(chatDirectory));
}
