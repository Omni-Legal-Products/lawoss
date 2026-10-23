/** Texty a vzhľad riadkov bočného panela (alfa2 B3): lehota v riadku a zvýraznenie predka otvorenej položky. */
import { t, type Language } from "@/i18n";
import { today } from "../okf/read-model";
import type { RowDeadline } from "./client-row";

/**
 * Predok otvorenej položky (klient, Prípady, vec, Chaty): výraznejší text a jemné pozadie. Zámerne nie
 * `data-active` (to má len otvorená položka, natívny kontrakt `SidebarMenuSubButton`).
 */
export const ANCESTOR_CLASS = "font-medium text-sidebar-foreground bg-sidebar-accent/50";

/** Farba textu lehoty: zmeškaná/na overenie červeno, blížiaca sa zlato (ako bod naliehavosti); význam nesie text. */
export function urgencyTextClass(urgency: string | undefined): string {
  return urgency === "hot" ? "text-destructive" : urgency === "near" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";
}

/** Krátky dátum do úzkeho riadku: deň a mesiac, iný rok s rokom (lehota o rok nesmie vyzerať ako budúci týždeň). */
export function shortDay(iso: string, locale: Language, todayIso = today()): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric", timeZone: "UTC", ...(iso.slice(0, 4) === todayIso.slice(0, 4) ? {} : { year: "numeric" }) }).format(date);
}

/** Krátky text lehoty v riadku („Lehota 25. 10.“); statické kľúče (CI audit). */
export function rowDeadlineText(deadline: RowDeadline, locale: Language): string {
  if (deadline.kind === "overdue") return t("lawoss.lite.overdue", locale);
  if (deadline.kind === "invalid") return t("lawoss.lite.due_invalid", locale);
  return t("lawoss.lite.row_deadline", locale, { date: shortDay(deadline.date, locale) });
}
