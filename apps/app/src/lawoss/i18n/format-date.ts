import { currentLocale } from "@/i18n";

/** #548: dátumy podľa jazyka rozhrania, nie systému (Electron inak berie jazyk OS). */
export const formatUiDate = (value: number | string | Date): string => new Date(value).toLocaleDateString(currentLocale());
export const formatUiDateTime = (value: number | string | Date): string => new Date(value).toLocaleString(currentLocale());
