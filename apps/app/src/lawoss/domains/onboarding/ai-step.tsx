/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { Language } from "@/i18n";
import type { Client } from "@/app/types";
import { discardPendingAnalytics, getStoredAnalyticsConsent } from "@/app/lib/analytics";
import { createLegalworkServerClient } from "@/app/lib/legalwork-server";
import { createClient } from "@/app/lib/opencode";
import { formatModelLabel } from "@/app/utils";
import { resolveWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { getConnectedProviderItems, useProviderListQuery } from "@/react-app/infra/provider-list-query";
import { resolveLegalworkConnection } from "@/react-app/shell/legalwork-connection";
import { useLocal } from "@/react-app/kernel/local-provider";
import {
  composerModelState,
  onboardingModelReadiness,
  type ComposerModelState,
} from "@/lawoss/shell/model-readiness";

type AiStepText = {
  checking: string;
  ready: string;
  none: string;
  pick: string;
  unavailable: string;
  open: string;
  continueReady: string;
  continueWithout: string;
  analyticsLabel: string;
  analyticsBody: string;
};

const aiStepText: Record<Language, AiStepText> = {
  sk: {
    checking: "Overujem pripojenie modelu…",
    ready: "Model je pripojený:",
    none: "Zatiaľ nemáte pripojený model. Pokračovať môžete aj bez neho, asistent však začne odpovedať až po pripojení modelu v nastaveniach AI.",
    pick: "Poskytovateľ je pripojený, ale model zatiaľ nie je vybraný. Vyberte ho v nastaveniach AI.",
    unavailable: "Vybraný model už nie je dostupný. Vyberte iný v nastaveniach AI.",
    open: "Otvoriť nastavenia AI",
    continueReady: "Pokračovať",
    continueWithout: "Pokračovať bez modelu",
    analyticsLabel: "Zdieľať anonymné údaje o používaní",
    analyticsBody: "Používané funkcie, chyby a výkon. Nikdy vaše dokumenty, prompty ani obsah spisov. Predvolene vypnuté, voľbu môžete kedykoľvek zmeniť v Nastaveniach.",
  },
  cs: {
    checking: "Ověřuji připojení modelu…",
    ready: "Model je připojen:",
    none: "Zatím nemáte připojený model. Pokračovat můžete i bez něj, asistent ale začne odpovídat až po připojení modelu v nastavení AI.",
    pick: "Poskytovatel je připojen, ale model zatím není vybrán. Vyberte ho v nastavení AI.",
    unavailable: "Vybraný model už není dostupný. Vyberte jiný v nastavení AI.",
    open: "Otevřít nastavení AI",
    continueReady: "Pokračovat",
    continueWithout: "Pokračovat bez modelu",
    analyticsLabel: "Sdílet anonymní údaje o používání",
    analyticsBody: "Používané funkce, chyby a výkon. Nikdy vaše dokumenty, prompty ani obsah spisů. Ve výchozím stavu vypnuto, volbu můžete kdykoli změnit v Nastavení.",
  },
  en: {
    checking: "Checking the model connection…",
    ready: "Model connected:",
    none: "No model is connected yet. You can continue without one, but the assistant only answers once a model is connected in the AI settings.",
    pick: "A provider is connected, but no model is selected yet. Choose one in the AI settings.",
    unavailable: "The selected model is no longer available. Choose another one in the AI settings.",
    open: "Open AI settings",
    continueReady: "Continue",
    continueWithout: "Continue without a model",
    analyticsLabel: "Share anonymous usage data",
    analyticsBody: "Features you use, errors and performance. Never your documents, prompts or matter content. Off by default, you can change this in Settings at any time.",
  },
  de: {
    checking: "Modellverbindung wird geprüft…",
    ready: "Modell verbunden:",
    none: "Noch ist kein Modell verbunden. Sie können ohne Modell fortfahren, der Assistent antwortet aber erst, wenn in den KI-Einstellungen ein Modell verbunden ist.",
    pick: "Ein Anbieter ist verbunden, aber noch kein Modell ausgewählt. Wählen Sie es in den KI-Einstellungen.",
    unavailable: "Das ausgewählte Modell ist nicht mehr verfügbar. Wählen Sie in den KI-Einstellungen ein anderes.",
    open: "KI-Einstellungen öffnen",
    continueReady: "Weiter",
    continueWithout: "Ohne Modell fortfahren",
    analyticsLabel: "Anonyme Nutzungsdaten teilen",
    analyticsBody: "Verwendete Funktionen, Fehler und Leistung. Niemals Ihre Dokumente, Prompts oder Akteninhalte. Standardmäßig aus, Sie können dies jederzeit in den Einstellungen ändern.",
  },
};

export type AiModelView = { state: ComposerModelState | "checking"; modelLabel?: string };

/** Pure view of the AI step: model state, the way to AI settings, continue and the analytics choice. */
export function AiStepView({
  locale,
  model,
  analyticsEnabled,
  busy,
  onAnalyticsChange,
  onOpenAiSettings,
  onContinue,
}: {
  locale: Language;
  model: AiModelView;
  analyticsEnabled: boolean;
  busy: boolean;
  onAnalyticsChange: (enabled: boolean) => void;
  onOpenAiSettings: () => void;
  /** Absent on the path without OKF, where the working folder step finishes onboarding. */
  onContinue?: () => void;
}) {
  const text = aiStepText[locale];
  const message = {
    checking: text.checking,
    ready: text.ready,
    "no-model": text.none,
    "pick-model": text.pick,
    unavailable: text.unavailable,
  }[model.state];
  const ready = model.state === "ready";
  return (
    <>
      <p
        role="status"
        data-lawoss-ai-model={model.state}
        className={ready ? "flex items-start gap-2" : "flex items-start gap-2 rounded border border-amber-500/60 p-3"}
      >
        {model.state === "checking" ? (
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
        ) : ready ? (
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-green-600" />
        ) : (
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
        )}
        <span>
          {message}
          {ready && model.modelLabel ? <b> {model.modelLabel}</b> : null}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onOpenAiSettings}>
          <ExternalLink />
          {text.open}
        </Button>
        {onContinue ? (
          <Button disabled={busy || model.state === "checking"} onClick={onContinue}>
            {ready ? text.continueReady : text.continueWithout}
          </Button>
        ) : null}
      </div>
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <Switch
          aria-label={text.analyticsLabel}
          checked={analyticsEnabled}
          onCheckedChange={onAnalyticsChange}
          disabled={busy}
        />
        <span className="grid gap-1">
          <span className="font-medium">{text.analyticsLabel}</span>
          <span className="text-muted-foreground">{text.analyticsBody}</span>
        </span>
      </label>
    </>
  );
}

type OpencodeTarget = { client: Client; baseUrl: string; directory: string };

/**
 * The OpenCode endpoint whose provider list the composer would read: the active
 * workspace, else the first local one. Null when no workspace exists yet; the
 * readiness then falls back exactly as the composer does before its query resolves.
 */
async function resolveOpencodeTarget(): Promise<OpencodeTarget | null> {
  const connection = await resolveLegalworkConnection();
  if (!connection.normalizedBaseUrl || !(connection.resolvedToken || connection.resolvedHostToken)) return null;
  const server = createLegalworkServerClient({
    baseUrl: connection.normalizedBaseUrl,
    token: connection.resolvedToken || undefined,
    hostToken: connection.resolvedHostToken || undefined,
  });
  const list = await server.listWorkspaces();
  const workspace =
    list.items.find((item) => item.id === list.activeId) ??
    list.items.find((item) => item.workspaceType !== "remote");
  if (!workspace) return null;
  const endpoint = resolveWorkspaceEndpoint(workspace, {
    baseUrl: connection.normalizedBaseUrl,
    token: connection.resolvedToken,
  });
  if (!endpoint?.token) return null;
  const directory = workspace.path?.trim() ?? "";
  return {
    client: createClient(endpoint.opencodeBaseUrl, directory || undefined, { token: endpoint.token, mode: "legalwork" }),
    baseUrl: endpoint.opencodeBaseUrl,
    directory,
  };
}

function useOnboardingModel(): AiModelView {
  const local = useLocal();
  const [target, setTarget] = useState<OpencodeTarget | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void resolveOpencodeTarget()
      .catch(() => null)
      .then((value) => {
        if (!cancelled) setTarget(value);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const query = useProviderListQuery({
    client: target?.client ?? null,
    baseUrl: target?.baseUrl,
    directory: target?.directory,
  });
  if (target === undefined || (target && query.isPending)) return { state: "checking" };
  const readiness = onboardingModelReadiness(local.prefs.defaultModel, query.data);
  const state = composerModelState(readiness);
  return state === "ready"
    ? { state, modelLabel: formatModelLabel(readiness.selectedModel, getConnectedProviderItems(query.data)) }
    : { state };
}

/**
 * AI step with live state. The analytics choice is written to the stored
 * preference the Settings toggle uses; an untouched switch leaves it unset.
 */
export function OnboardingAiPanel(props: {
  locale: Language;
  busy: boolean;
  onOpenAiSettings: () => void;
  onContinue?: () => void;
}) {
  const local = useLocal();
  const model = useOnboardingModel();
  const [analyticsEnabled, setAnalyticsEnabled] = useState(() => getStoredAnalyticsConsent() === true);
  const onAnalyticsChange = (enabled: boolean) => {
    if (!enabled) discardPendingAnalytics();
    setAnalyticsEnabled(enabled);
    local.setPrefs((previous) => ({ ...previous, analyticsEnabled: enabled }));
  };
  return <AiStepView {...props} model={model} analyticsEnabled={analyticsEnabled} onAnalyticsChange={onAnalyticsChange} />;
}
