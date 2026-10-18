import { t, type Language } from '@/i18n';
import { daysUntil } from '../../../../../lawoss/okf-reader/src/view-rules.ts';
export { HORIZON_DAYS, daysUntil, isCalendarDay, urgencyOf, inHorizon, deadlineText, deadlineKey } from '../../../../../lawoss/okf-reader/src/view-rules.ts';
export type { Urgency } from '../../../../../lawoss/okf-reader/src/view-rules.ts';
/** Slovný termín z počtu dní („dnes", „zajtra", „o 5 dní", „po lehote") - jediné znenie pre všetky pohľady. */
export function dueTextFromDays(left: number, locale: Language, invalid?: boolean): string {
  if (invalid || Number.isNaN(left)) return t("lawoss.lite.due_invalid", locale);
  if (left < 0) return t("lawoss.lite.overdue", locale);
  if (left === 0) return t("lawoss.lite.due_today", locale);
  if (left === 1) return t("lawoss.lite.due_tomorrow", locale);
  return t("lawoss.lite.due_in_days", locale, { count: left });
}

/** Slovný termín lehoty voči dnešku. */
export const dueText = (date: string, todayIso: string, locale: Language, invalid?: boolean): string =>
  dueTextFromDays(daysUntil(todayIso, date), locale, invalid);
