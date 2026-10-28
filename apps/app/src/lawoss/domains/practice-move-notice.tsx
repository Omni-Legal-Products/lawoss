/** @jsxImportSource react */
/**
 * „Dokončiť presun praxe“ (N-A7-1): klienti presunutej praxe sú prepojení, ale prax v profile ostala na starej ceste
 * (prerušené alebo zlyhané dokončenie). Server to zistí v stave onboardingu (`practiceMove`); krok sa dá zopakovať.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useOkfConnection, OFFICE_SCOPE_RESTORED } from "../okf/read-model";
import { lastSegment } from "../okf/moved-folder";

type PracticeMove = { previousRoot: string; folderPath: string };

export function PracticeMoveNoticeView({ locale, folder, busy, failed, onFinish }: { locale: Language; folder: string; busy: boolean; failed: boolean; onFinish: () => void }) {
  return (
    <div className="lw-status warn grid gap-2" role="status" data-lawoss-practice-move>
      <p>{t("lawoss.lite.practice_move_text", locale, { folder })}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="lw-btn gold" disabled={busy} onClick={onFinish}>{t("lawoss.lite.practice_move_finish", locale)}</button>
      </div>
      {failed ? <p>{t("lawoss.lite.practice_move_failed", locale)}</p> : null}
    </div>
  );
}

export function PracticeMoveNotice() {
  const locale = useLocale();
  const { connection } = useOkfConnection();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const client = connection?.client;
  const move = useQuery({
    queryKey: ["lawoss-practice-move", connection?.baseUrl ?? ""],
    enabled: Boolean(client),
    retry: false,
    staleTime: 0,
    queryFn: async (): Promise<PracticeMove | null> => (await client?.onboardingStatus())?.practiceMove ?? null,
  });
  if (!client || !move.data) return null;
  const target = move.data;
  const finish = async () => {
    setBusy(true); setFailed(false);
    try {
      await client.lawossMovedFolder("moved-practice", target);
      await cache.invalidateQueries({ queryKey: ["lawoss-practice-move"] });
      await cache.invalidateQueries({ queryKey: ["lawoss-onboarding-profile"] });
      window.dispatchEvent(new CustomEvent(OFFICE_SCOPE_RESTORED));
    } catch (error) {
      console.warn("LAWOSS: dokončenie presunu praxe", error);
      setFailed(true);
    } finally { setBusy(false); }
  };
  return <PracticeMoveNoticeView locale={locale} folder={lastSegment(target.folderPath)} busy={busy} failed={failed} onFinish={() => void finish()} />;
}
