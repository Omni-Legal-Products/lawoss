import { isLanguage, LANGUAGE_PREF_KEY, setLanguagePreference, setLocale } from "@/i18n";

const SCOPE_KEY = "legalwork.officeLocaleScope";

/** Bind the cached language to this office_ token; a different credential starts from the system language. */
export async function bindOfficeUiLocale(token: string): Promise<void> {
  try {
    if (token && globalThis.crypto?.subtle) {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      const scope = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const previous = window.localStorage.getItem(SCOPE_KEY);
      if (previous && previous !== scope) window.localStorage.removeItem(LANGUAGE_PREF_KEY);
      window.localStorage.setItem(SCOPE_KEY, scope);
    }
  } catch { /* Storage failure cannot block connection or an in-memory language change. */ }
}
export function applyOfficeUiLocale(value: unknown): void {
  if (isLanguage(value)) setLocale(value);
}
export function clearOfficeUiLocale(): void {
  try { window.localStorage.removeItem(SCOPE_KEY); window.localStorage.removeItem(LANGUAGE_PREF_KEY); } catch { /* optional cache */ }
  setLanguagePreference("system");
}
