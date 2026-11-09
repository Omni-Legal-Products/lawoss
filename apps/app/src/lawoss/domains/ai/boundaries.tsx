/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { OnboardingReturnLink } from "../onboarding/wizard/return-link";
import type { AiBoundaries } from "@legalwork/types/ai-governance";
import { Switch } from "@/components/ui/switch";
import { t, type Language } from "@/i18n";
import {
  LayoutSection,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
} from "@/react-app/domains/settings/settings-layout";
import { resolveLegalworkConnection, type ResolvedLegalworkConnection } from "@/react-app/shell/legalwork-connection";
import { createAiGuidanceClient } from "./guidance";
import { publishAiBoundaries, useAiBoundaries } from "./boundaries-store";

/** Native Settings → AI switch „AI hranice" (server: apps/server/src/lawoss/ai-boundaries.ts). */
export async function saveAiBoundaries(connection: ResolvedLegalworkConnection, enforced: boolean): Promise<AiBoundaries> {
  const view = await createAiGuidanceClient(connection).setAiBoundaries(enforced);
  if (!view.boundaries) throw new Error("AI boundaries were not returned");
  return view.boundaries;
}

/** Confirmed repair of a damaged stored value; the server keeps the boundaries on. */
export async function repairDamagedAiBoundaries(connection: ResolvedLegalworkConnection): Promise<AiBoundaries> {
  const view = await createAiGuidanceClient(connection).repairAiBoundaries();
  if (!view.boundaries) throw new Error("AI boundaries were not returned");
  return view.boundaries;
}

function stateText(boundaries: AiBoundaries | null, locale: Language) {
  if (boundaries?.locked) return {state: "locked", text: t("lawoss.ai_boundaries.state_locked", locale)};
  if (boundaries?.source === "invalid") return {state: "invalid", text: t("lawoss.ai_boundaries.state_invalid", locale)};
  if (boundaries?.enforced) return {state: "on", text: t("lawoss.ai_boundaries.state_on", locale)};
  return {state: "off", text: t("lawoss.ai_boundaries.state_off", locale)};
}

export function AiBoundariesRowView(props: {locale: Language; boundaries: AiBoundaries | null; canWrite: boolean; busy: boolean; failed: boolean; loadFailed?: boolean; onChange: (enforced: boolean) => void;
  confirmingRepair?: boolean; repairFailed?: boolean; onRepairRequest?: () => void; onRepairCancel?: () => void; onRepairConfirm?: () => void}) {
  const {state, text} = stateText(props.boundaries, props.locale);
  const repairable = state === "invalid" && props.canWrite && Boolean(props.onRepairConfirm);
  const title = t("lawoss.ai_boundaries.title", props.locale);
  return (
    <LayoutSection>
      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{title}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("lawoss.ai_boundaries.description", props.locale)}</LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Switch aria-label={title} checked={Boolean(props.boundaries?.enforced)}
              disabled={!props.canWrite || !props.boundaries || props.boundaries.locked || props.busy}
              onCheckedChange={(next: boolean) => props.onChange(next)} />
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
        <p role="status" data-lawoss-ai-boundaries={state} className="text-[13px] leading-relaxed text-foreground">{text}</p>
        {repairable ? props.confirmingRepair ? (
          <div role="group" data-lawoss-ai-boundaries-repair="confirm" className="flex flex-col gap-2 text-[13px]">
            <p className="text-foreground">{t("lawoss.ai_boundaries.repair_confirm", props.locale)}</p>
            <div className="flex gap-2">
              <button type="button" className="rounded-md border px-3 py-1" disabled={props.busy} onClick={() => props.onRepairConfirm?.()}>{t("lawoss.ai_boundaries.repair_confirm_action", props.locale)}</button>
              <button type="button" className="rounded-md px-3 py-1 text-muted-foreground" disabled={props.busy} onClick={() => props.onRepairCancel?.()}>{t("lawoss.ai_boundaries.repair_cancel", props.locale)}</button>
            </div>
          </div>
        ) : (
          <div><button type="button" data-lawoss-ai-boundaries-repair="request" className="rounded-md border px-3 py-1 text-[13px]" disabled={props.busy} onClick={() => props.onRepairRequest?.()}>{t("lawoss.ai_boundaries.repair", props.locale)}</button></div>
        ) : null}
        {props.repairFailed ? <p role="alert" className="text-[13px] text-destructive">{t("lawoss.ai_boundaries.repair_failed", props.locale)}</p> : null}
        {props.loadFailed ? <p role="alert" className="text-[13px] text-destructive">{t("lawoss.ai_boundaries.load_failed", props.locale)}</p>
          : !props.canWrite ? <p className="text-[13px] text-muted-foreground">{t("lawoss.ai_boundaries.host_only", props.locale)}</p> : null}
        {props.failed ? <p role="alert" className="text-[13px] text-destructive">{t("lawoss.ai_boundaries.save_failed", props.locale)}</p> : null}
      </LayoutSectionItem>
    </LayoutSection>
  );
}

export function AiBoundariesRow({locale}: {locale: Language}) {
  const [connection, setConnection] = useState<ResolvedLegalworkConnection | null>(null);
  const boundaries = useAiBoundaries();
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [loadFailed, setLoadFailed] = useState(false);
  const [confirmingRepair, setConfirmingRepair] = useState(false), [repairFailed, setRepairFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void resolveLegalworkConnection().then(async current => {
      if (!current.normalizedBaseUrl) return;
      if (active) setConnection(current);
      const view = await createAiGuidanceClient(current).aiGovernance();
      if (active) publishAiBoundaries(view.boundaries);
    }).catch(() => { if (active) setLoadFailed(true); });
    return () => {active = false;};
  }, []);
  const change = async (enforced: boolean) => {
    if (!connection) return;
    setBusy(true); setFailed(false);
    try {publishAiBoundaries(await saveAiBoundaries(connection, enforced)); setLoadFailed(false);}
    catch {setFailed(true);} finally {setBusy(false);}
  };
  const repair = async () => {
    if (!connection) return;
    setBusy(true); setRepairFailed(false); setFailed(false);
    try {publishAiBoundaries(await repairDamagedAiBoundaries(connection)); setConfirmingRepair(false); setLoadFailed(false);}
    catch {setRepairFailed(true);} finally {setBusy(false);}
  };
  // C1: kto prišiel zo sprievodcu („Pripojiť poskytovateľa“), má hore cestu späť do nastavenia praxe.
  return <>
    <OnboardingReturnLink locale={locale} />
    <AiBoundariesRowView locale={locale} boundaries={boundaries} canWrite={Boolean(connection?.resolvedHostToken)}
      busy={busy} failed={failed} loadFailed={loadFailed} onChange={enforced => void change(enforced)}
      confirmingRepair={confirmingRepair} repairFailed={repairFailed} onRepairRequest={() => {setRepairFailed(false); setConfirmingRepair(true);}}
      onRepairCancel={() => setConfirmingRepair(false)} onRepairConfirm={() => void repair()} />
  </>;
}
