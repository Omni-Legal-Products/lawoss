import { initLocale, isLanguage, LANGUAGE_PREF_KEY, setLanguagePreference, setLocale } from "@/i18n";

const SCOPE_KEY = "legalwork.officeLocaleScope";
/** Locale is the only cached presentation value; capability bytes never enter persistent storage. */
export async function prepareOfficeUiLocale(capability: string): Promise<void> {
  try {
    if (capability && globalThis.crypto?.subtle) {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(capability));
      const scope = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const previous = window.localStorage.getItem(SCOPE_KEY);
      if (previous && previous !== scope) window.localStorage.removeItem(LANGUAGE_PREF_KEY);
      window.localStorage.setItem(SCOPE_KEY, scope);
    }
  } catch { /* Storage failure cannot block connection or an in-memory language change. */ }
  initLocale();
}
export function applyOfficeUiLocale(value: unknown): void {
  if (isLanguage(value)) setLocale(value);
}
export function clearOfficeUiLocale(): void {
  try { window.localStorage.removeItem(SCOPE_KEY); window.localStorage.removeItem(LANGUAGE_PREF_KEY); } catch { /* optional cache */ }
  setLanguagePreference("system");
}
