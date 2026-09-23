/**
 * Stavové texty OkfPage pro LAWOSS-lite: prostým jazykem, bez technických pojmů
 * a bez surových chybových hlášek (ty mohou obsahovat interní názvy).
 */
import { t, type Language } from "@/i18n";
import type { StateText } from "../domains/okf-page";
import type { MatterTextKey } from "../i18n/matters";

const LITE_KEY: Partial<Record<MatterTextKey, string>> = {
  retry: "state_retry",
  memoryError: "state_error",
  serverUnavailable: "state_error",
  incompleteRead: "state_error",
  connectionLoading: "state_loading",
  memoryLoading: "state_loading",
  refreshing: "state_loading",
  noWorkspace: "state_no_folder",
  openWorkspace: "state_open_folder",
  noMatterMemory: "state_empty",
  newMatter: "new_matter",
};

export function liteStateText(locale: Language): StateText {
  return (key, params) => {
    const lite = LITE_KEY[key];
    return lite ? t(`lawoss.lite.${lite}`, locale) : t(`lawoss.matters.${key}`, locale, params);
  };
}
