import { currentLocale } from "@/i18n";
import type { ProjectTemplateLocale } from "@legalwork/types/workspace";

/** Template presentation follows UI language; custom labels and values stay literal. */
export function currentTemplateLocale(): ProjectTemplateLocale {
  return currentLocale();
}
