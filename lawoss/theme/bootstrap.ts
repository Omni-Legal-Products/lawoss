/**
 * LAWOSS boot shims that must run before the upstream theme/locale bootstrap.
 * Kept in the green zone; the only upstream touch is one import in the entry.
 */
import { initUiMode } from "../../apps/app/src/lawoss/lite/ui-mode";

const THEME_PREF_KEY = "legalwork.react.settings.theme-mode";
/** Older key that the pre-paint script in `apps/app/index.html` reads before any module runs. */
const LEGACY_THEME_PREF_KEY = "legalwork.themePref";
const MIGRATION_KEY = "lawoss.theme-migrated-to-dark";

/**
 * Alfa: svetlá téma nie je navrhnutá (rozhodnutie MČ 5. 10. 2026, M11), preto sa
 * pri každom štarte vynúti tmavá. Upstream výber témy (`ThemeSection`) sa nikde
 * nevykresľuje, takže svetlú sa dalo dostať len z uloženej hodnoty "light" alebo
 * "system". Návrat k voľbe používateľa: nastaviť na `null`.
 */
export const ALPHA_FORCED_THEME: "dark" | null = "dark";

/** Writes the forced theme to both stored keys; `null` leaves the user's choice alone. */
export function enforceTheme(storage: Pick<Storage, "getItem" | "setItem">, forced: "dark" | null): void {
  if (!forced) return;
  for (const key of [THEME_PREF_KEY, LEGACY_THEME_PREF_KEY]) {
    if (storage.getItem(key) !== forced) storage.setItem(key, forced);
  }
}

/**
 * One-time migration: profiles created before the LAWOSS fork stored the old
 * upstream default ("light"). Dark is the designed LAWOSS theme, so flip the
 * stored preference exactly once; afterwards the user's own choice always wins
 * (unless the alpha forces dark, see `ALPHA_FORCED_THEME`).
 */
export function bootstrapLawoss(): void {
  if (typeof window === "undefined") return;
  // Režim lite/pro přepnutý v jiném okně (odpojená konverzace) platí i tady.
  initUiMode();
  try {
    enforceTheme(window.localStorage, ALPHA_FORCED_THEME);
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
