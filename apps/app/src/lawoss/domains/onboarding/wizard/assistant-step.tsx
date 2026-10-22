/** @jsxImportSource react */
/**
 * Krok 4 „Váš AI asistent“ (C1): karty pripojených poskytovateľov so stavom, diagram toku podkladov, stav AI
 * hraníc pri akcii a „Pokračovať bez AI“. Pripojenie ostáva v natívnych Nastaveniach AI (Native UI first);
 * dlhé vysvetlenie o ochrane údajov (`AiGuidance`) je v rozbaľovacích Podrobnostiach.
 */
import type { ReactNode } from "react";
import { Bot, CircleAlert, CircleCheck, Cloud, FileText, Loader2, Plug, ShieldCheck, ShieldOff } from "lucide-react";
import type { Language } from "@/i18n";
import { AiGuidance } from "../../ai/guidance";
import { useAiBoundaries } from "../../ai/boundaries-store";
import { useOnboardingModel, type AiModelView } from "../ai-step";
import { FlowDiagram, type FlowNode } from "./illustrations";
import { StatusBadge, StepScreen, type StatusTone } from "./wizard-frame";
import type { WizardText, WizardTextKey } from "./wizard-text";

const STATE_TEXT: Record<AiModelView["state"], WizardTextKey> = {
  checking: "aiStateChecking",
  ready: "aiStateReady",
  "no-model": "aiStateNone",
  "pick-model": "aiStatePick",
  unavailable: "aiStateUnavailable",
  "no-workspace": "aiStateNoWorkspace",
};

export const modelTone = (state: AiModelView["state"]): StatusTone =>
  state === "ready" ? "ok" : state === "checking" ? "checking" : state === "no-model" || state === "no-workspace" ? "missing" : "warn";

const toneIcon = (tone: StatusTone): ReactNode =>
  tone === "ok" ? <CircleCheck className="size-3.5" /> : tone === "checking" ? <Loader2 className="size-3.5 animate-spin" /> : <CircleAlert className="size-3.5" />;

export function AssistantStepView({ text, locale, model, boundariesOn, busy, nav, onOpenAiSettings, onContinue }: {
  text: WizardText;
  locale: Language;
  model: AiModelView;
  /** Stav AI hraníc zo servera; `null` = zatiaľ neznámy (veta sa neukáže). */
  boundariesOn: boolean | null;
  busy: boolean;
  nav?: ReactNode;
  onOpenAiSettings: () => void;
  onContinue: () => void;
}) {
  const ready = model.state === "ready";
  const providers = model.providers ?? [];
  const tone = modelTone(model.state);
  const nodes: FlowNode[] = [
    { key: "docs", icon: <FileText className="size-5" />, label: text("aiFlowDocs") },
    { key: "assistant", icon: <Bot className="size-5" />, label: text("aiFlowAssistant") },
    { key: "provider", icon: <Cloud className="size-5" />, label: providers[0]?.name ?? text("aiFlowProvider"), emphasis: true },
  ];
  return (
    <StepScreen
      step="ai" title={text("aiTitle")} lead={<p>{text("aiLead")}</p>} nav={nav}
      details={<AiGuidance locale={locale} />} detailsLabel={text("aiDetails")}
    >
      <figure className="lw-wiz-figure">
        <FlowDiagram label={text("aiFlowCaption")} nodes={nodes} />
        <figcaption>{text("aiFlowCaption")}</figcaption>
      </figure>
      <section className="grid gap-2" aria-label={text("aiProviders")}>
        <h3 className="lw-wiz-label">{text("aiProviders")}</h3>
        <ul className="lw-wiz-providers">
          {providers.length ? providers.map((provider, index) => (
            <li key={provider.id} className="lw-wiz-provider" data-connected="true">
              <Plug className="size-5" aria-hidden />
              <span className="min-w-0 flex-1">
                <strong>{provider.name}</strong>
                {index === 0 ? <small>{ready && model.modelLabel ? text("aiModel", { model: model.modelLabel }) : text("aiNoModel")}</small> : null}
              </span>
              <StatusBadge text={text} tone="ok" icon={<CircleCheck className="size-3.5" />} />
            </li>
          )) : (
            <li className="lw-wiz-provider" data-connected="false">
              <Plug className="size-5" aria-hidden />
              <span className="min-w-0 flex-1"><strong>{text("aiNoProvider")}</strong><small>{text("aiNotConnected")}</small></span>
              <StatusBadge text={text} tone={model.state === "checking" ? "checking" : "missing"} icon={toneIcon(model.state === "checking" ? "checking" : "missing")} />
            </li>
          )}
        </ul>
      </section>
      <p role="status" className="lw-wiz-state" data-lawoss-ai-model={model.state} data-tone={tone}>
        <span aria-hidden="true">{toneIcon(tone)}</span>
        {text(STATE_TEXT[model.state])}
      </p>
      {boundariesOn === null ? null : (
        <p className="lw-wiz-note" data-lawoss-ai-boundaries={boundariesOn ? "on" : "off"}>
          {boundariesOn ? <ShieldCheck className="size-4 shrink-0" aria-hidden /> : <ShieldOff className="size-4 shrink-0" aria-hidden />}
          {text(boundariesOn ? "aiBoundariesOn" : "aiBoundariesOff")}
        </p>
      )}
      <div className="lw-wiz-actions">
        {ready ? (
          <>
            <button type="button" className="lw-btn gold" disabled={busy} onClick={onContinue}>{text("continue")}</button>
            <button type="button" className="lw-btn" disabled={busy} onClick={onOpenAiSettings}>{text("aiManage")}</button>
          </>
        ) : (
          <>
            {model.state === "no-workspace" ? null : (
              <button type="button" className="lw-btn gold" disabled={busy || model.state === "checking"} onClick={onOpenAiSettings}>{text("aiConnect")}</button>
            )}
            <button type="button" className={model.state === "no-workspace" ? "lw-btn gold" : "lw-btn"} disabled={busy || model.state === "checking"} onClick={onContinue}>{text("aiWithout")}</button>
          </>
        )}
      </div>
    </StepScreen>
  );
}

/** Krok s živým stavom modelu a AI hraníc. */
export function AssistantStep(props: Omit<Parameters<typeof AssistantStepView>[0], "model" | "boundariesOn">) {
  const model = useOnboardingModel();
  const boundaries = useAiBoundaries();
  return <AssistantStepView {...props} model={model} boundariesOn={boundaries ? boundaries.enforced : null} />;
}
