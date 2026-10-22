/** Texty a vzhľad riadkov bočného panela (alfa2 B3): lehota v riadku a zvýraznenie predka otvorenej položky. */
import { t, type Language } from "@/i18n";
import { formatDay } from "../okf/read-model";
import type { RowDeadline } from "./client-row";

/**
 * Predok otvorenej položky (klient, Prípady, vec, Chaty): výraznejší text a jemné pozadie. Zámerne nie
 * `data-active` (to má len otvorená položka, natívny kontrakt `SidebarMenuSubButton`).
 */
export const ANCESTOR_CLASS = "font-medium text-sidebar-foreground bg-sidebar-accent/50";

/** Text lehoty v riadku; statické kľúče (CI audit), dátum ako v ostatných pohľadoch. */
export function rowDeadlineText(deadline: RowDeadline, locale: Language): string {
  if (deadline.kind === "overdue") return t("lawoss.lite.overdue", locale);
  if (deadline.kind === "invalid") return t("lawoss.lite.due_invalid", locale);
  return t("lawoss.lite.matter_next_deadline", locale, { date: formatDay(deadline.date, locale) });
}
