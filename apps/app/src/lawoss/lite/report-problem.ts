/**
 * #464: „Nahlásiť chybu alebo nápad“ otvorí formulár na webe LAWOSS (lawoss.app/{sk|cz|en}/alfa/hlasenie)
 * v prehliadači. V desktopovej appke ide cez `openDesktopUrl` (IPC → safe-open v hlavnom procese, len http/https/
 * mailto) a čaká na výsledok; appka potom oznámi, že sa formulár otvoril, alebo pri zlyhaní ukáže adresu.
 */
import { t, type Language } from "@/i18n";
import { feedbackPageUrl } from "./sidebar-model";

type Notify = { success: (message: string) => unknown; error: (message: string) => unknown };

/** Adresa bez protokolu do textu oznámenia. */
const shown = (url: string) => url.replace(/^https?:\/\//, "");

export async function reportProblem(locale: Language, open: (url: string) => Promise<void>, notify: Notify): Promise<boolean> {
  const url = feedbackPageUrl(locale);
  try {
    await open(url);
    notify.success(t("lawoss.lite.report_opened", locale, { url: shown(url) }));
    return true;
  } catch {
    notify.error(t("lawoss.lite.report_failed", locale, { url: shown(url) }));
    return false;
  }
}
