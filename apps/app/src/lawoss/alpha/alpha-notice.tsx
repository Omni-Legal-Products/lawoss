/** @jsxImportSource react */
import { useSyncExternalStore } from "react";
import { TriangleAlert } from "lucide-react";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ALPHA_NOTICE } from "../feature-flags";

/** Skrytie platí do najbližšieho spustenia aplikácie (`sessionStorage`), nikdy nie natrvalo. */
export const ALPHA_NOTICE_STORAGE_KEY = "lawoss.alpha.notice.dismissed";

const listeners = new Set<() => void>();

function readDismissed(): boolean {
  try { return sessionStorage.getItem(ALPHA_NOTICE_STORAGE_KEY) === "1"; } catch { return false; }
}

let dismissed = readDismissed();

function notify(): void { for (const listener of listeners) listener(); }

/** Skryje pruh; keď úložisko nejde zapísať, platí to aspoň do zatvorenia okna. */
export function dismissAlphaNotice(): void {
  dismissed = true;
  try { sessionStorage.setItem(ALPHA_NOTICE_STORAGE_KEY, "1"); } catch { /* bez úložiska sa pruh ukáže pri ďalšom spustení */ }
  notify();
}

/** Test seam: znovu načíta úložisko ako po spustení aplikácie. */
export function reloadAlphaNoticeFromStorage(): void {
  dismissed = readDismissed();
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const currentDismissed = (): boolean => dismissed;

/**
 * Text upozornenia. Bez `onDismiss` je to trvalý odsek bez tlačidla (krok Priečinok v onboardingu),
 * s ním tenký pruh, ktorý advokát vezme na vedomie tlačidlom.
 */
export function AlphaNoticeView({ locale, onDismiss }: { locale: Language; onDismiss?: () => void }) {
  return (
    <Alert
      variant="warning"
      role="status"
      data-lawoss-alpha-notice={onDismiss ? "bar" : "inline"}
      className={onDismiss ? "flex flex-none items-center gap-3 rounded-none border-x-0 border-t-0 py-2" : "flex items-start gap-3"}
    >
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <AlertDescription className="flex-1 text-foreground">{t("lawoss.alpha.notice", locale)}</AlertDescription>
      {onDismiss ? (
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onDismiss}>{t("lawoss.alpha.dismiss", locale)}</Button>
      ) : null}
    </Alert>
  );
}

/** Pruh nad obsahom LAWOSS; po „Rozumiem“ zmizne do najbližšieho spustenia. */
export function AlphaNotice() {
  const locale = useLocale();
  const hidden = useSyncExternalStore(subscribe, currentDismissed, currentDismissed);
  if (!ALPHA_NOTICE || hidden) return null;
  return <AlphaNoticeView locale={locale} onDismiss={dismissAlphaNotice} />;
}

/** Trvalý text bez možnosti skryť; pri vypnutom prepínači nič. */
export function AlphaNoticeInline() {
  const locale = useLocale();
  if (!ALPHA_NOTICE) return null;
  return <AlphaNoticeView locale={locale} />;
}
