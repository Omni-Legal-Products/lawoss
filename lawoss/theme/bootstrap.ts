/**
 * LAWOSS boot shims that must run before the upstream theme/locale bootstrap.
 * Kept in the green zone; the only upstream touch is one import in the entry.
 */
import { initUiMode } from "../../apps/app/src/lawoss/lite/ui-mode";

const THEME_PREF_KEY = "legalwork.react.settings.theme-mode";
const MIGRATION_KEY = "lawoss.theme-migrated-to-dark";

/**
 * One-time migration: profiles created before the LAWOSS fork stored the old
 * upstream default ("light"). Dark is the designed LAWOSS theme, so flip the
 * stored preference exactly once; afterwards the user's own choice always wins.
 */
export function bootstrapLawoss(): void {
  if (typeof window === "undefined") return;
  // Režim lite/pro přepnutý v jiném okně (odpojená konverzace) platí i tady.
  initUiMode();
  try {
    if (window.localStorage.getItem(MIGRATION_KEY) === "1") return;
    window.localStorage.setItem(MIGRATION_KEY, "1");
    if (window.localStorage.getItem(THEME_PREF_KEY) === "light") {
      window.localStorage.setItem(THEME_PREF_KEY, "dark");
    }
  } catch {
    // storage unavailable (private mode, capture) — nothing to migrate
  }
  // initLocale owns language detection; only an explicit user selection is persisted.
}
