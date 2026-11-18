/** @jsxImportSource react */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { isDesktopRuntime } from "@/app/utils";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";

/**
 * #554: uložené nastavenia klienta sa nedajú prečítať (server: `lawoss/unreadable-client-settings.ts`). Engine mu preto
 * zamietne každé oprávnenie a agent v chate hlási len „Akcia zlyhala“. Prehľad klienta aj chat to povedia červeným
 * rámčekom ako `other-client-warning.tsx` a ponúknu obnovu predvolených nastavení so zálohou originálu.
 */
export function clientSettingsDamaged(details: unknown): boolean {
  return typeof details === "object" && details !== null && "lawossClientSettingsUnreadable" in details && details.lawossClientSettingsUnreadable === true;
}

export function ClientSettingsWarningView(props: { locale: Language; damaged: boolean; canRepair: boolean; confirming?: boolean; busy?: boolean; failed?: boolean;
  onRequest?: () => void; onConfirm?: () => void; onCancel?: () => void }) {
  if (!props.damaged) return null;
  const { locale } = props;
  return (
    <div role="alert" data-lawoss-client-settings-damaged="" className="mt-2 flex items-start gap-2 rounded-lg border border-red-7/30 bg-red-3/40 px-3 py-2 text-[12.5px] leading-5 text-red-11">
      <AlertTriangle aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 space-y-2">
        <p className="font-semibold">{t("lawoss.client_settings.damaged_title", locale)}</p>
        <p>{t("lawoss.client_settings.damaged_body", locale)}</p>
        {props.canRepair ? props.confirming ? (
          <div role="group" data-lawoss-client-settings-repair="confirm" className="space-y-2">
            <p>{t("lawoss.client_settings.repair_confirm", locale)}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-md border border-red-7/40 px-3 py-1" disabled={props.busy} onClick={props.onConfirm}>{t("lawoss.client_settings.repair_confirm_action", locale)}</button>
              <button type="button" className="rounded-md px-3 py-1" disabled={props.busy} onClick={props.onCancel}>{t("lawoss.client_settings.repair_cancel", locale)}</button>
            </div>
          </div>
        ) : (
          <button type="button" data-lawoss-client-settings-repair="request" className="rounded-md border border-red-7/40 px-3 py-1" disabled={props.busy} onClick={props.onRequest}>{t("lawoss.client_settings.repair", locale)}</button>
        ) : <p>{t("lawoss.client_settings.repair_desktop_only", locale)}</p>}
        {props.failed ? <p data-lawoss-client-settings-repair-failed="">{t("lawoss.client_settings.repair_failed", locale)}</p> : null}
      </div>
    </div>
  );
}

/** Číta tú istú odpoveď o projekte ako Domov projektu (`["project", workspaceId]`), takže tam nepridá požiadavku. */
export function ClientSettingsWarning({ client, workspaceId }: { client: LegalworkServerClient; workspaceId: string }) {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const details = useQuery({ queryKey: ["project", workspaceId], queryFn: () => client.getProjectDetails(workspaceId) });
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const repair = async () => {
    setBusy(true); setFailed(false);
    try {
      await client.repairClientSettings(workspaceId);
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: ["project", workspaceId] });
    } catch { setFailed(true); }
    finally { setBusy(false); }
  };
  return <ClientSettingsWarningView locale={locale} damaged={clientSettingsDamaged(details.data)} canRepair={isDesktopRuntime()} confirming={confirming} busy={busy} failed={failed}
    onRequest={() => setConfirming(true)} onCancel={() => setConfirming(false)} onConfirm={() => { void repair(); }} />;
}
