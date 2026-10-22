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

function stateText(boundaries: AiBoundaries | null, locale: Language) {
  if (boundaries?.locked) return {state: "locked", text: t("lawoss.ai_boundaries.state_locked", locale)};
  if (boundaries?.source === "invalid") return {state: "invalid", text: t("lawoss.ai_boundaries.state_invalid", locale)};
  if (boundaries?.enforced) return {state: "on", text: t("lawoss.ai_boundaries.state_on", locale)};
  return {state: "off", text: t("lawoss.ai_boundaries.state_off", locale)};
}

export function AiBoundariesRowView(props: {locale: Language; boundaries: AiBoundaries | null; canWrite: boolean; busy: boolean; failed: boolean; loadFailed?: boolean; onChange: (enforced: boolean) => void}) {
  const {state, text} = stateText(props.boundaries, props.locale);
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
  // C1: kto prišiel zo sprievodcu („Pripojiť poskytovateľa“), má hore cestu späť do nastavenia praxe.
  return <>
    <OnboardingReturnLink locale={locale} />
    <AiBoundariesRowView locale={locale} boundaries={boundaries} canWrite={Boolean(connection?.resolvedHostToken)}
      busy={busy} failed={failed} loadFailed={loadFailed} onChange={enforced => void change(enforced)} />
  </>;
}
