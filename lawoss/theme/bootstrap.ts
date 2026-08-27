/**
 * LAWOSS boot shims that must run before the upstream theme/locale bootstrap.
 * Kept in the green zone; the only upstream touch is one import in the entry.
 */

const THEME_PREF_KEY = "legalwork.react.settings.theme-mode";
const MIGRATION_KEY = "lawoss.theme-migrated-to-dark";
const LANGUAGE_PREF_KEY = "legalwork.language";

/**
 * One-time migration: profiles created before the LAWOSS fork stored the old
 * upstream default ("light"). Dark is the designed LAWOSS theme, so flip the
 * stored preference exactly once; afterwards the user's own choice always wins.
 */
export function bootstrapLawoss(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(MIGRATION_KEY) === "1") return;
    window.localStorage.setItem(MIGRATION_KEY, "1");
    if (window.localStorage.getItem(THEME_PREF_KEY) === "light") {
      window.localStorage.setItem(THEME_PREF_KEY, "dark");
    }
  } catch {
    // storage unavailable (private mode, capture) — nothing to migrate
  }
  try {
    // First run: default the UI language from the OS (sk/cs), otherwise keep
    // the upstream English default. A stored choice always wins.
    if (!window.localStorage.getItem(LANGUAGE_PREF_KEY)) {
      const system = (navigator.language || "").toLowerCase();
      if (system.startsWith("sk")) window.localStorage.setItem(LANGUAGE_PREF_KEY, "sk");
      else if (system.startsWith("cs")) window.localStorage.setItem(LANGUAGE_PREF_KEY, "cs");
    }
  } catch {
    // ignore
  }
}
