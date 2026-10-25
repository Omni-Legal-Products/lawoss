/** @jsxImportSource react */
import { AiGuidance } from "../ai/guidance";
import { useEffect, useState } from "react";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import { preferRealWorkspace } from "../../home-workspace";
import { CircleAlert, CircleCheck, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Language } from "@/i18n";
import type { Client, ModelRef } from "@/app/types";
import { createLegalworkServerClient } from "@/app/lib/legalwork-server";
import { createClient } from "@/app/lib/opencode";
import { resolveWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { normalizeDirectoryPath } from "@/app/utils";
import { useProviderListQuery } from "@/react-app/infra/provider-list-query";
import { resolveLegalworkConnection } from "@/react-app/shell/legalwork-connection";
import { useLocal } from "@/react-app/kernel/local-provider";
import type { ComposerModelState } from "@/lawoss/shell/model-readiness";
import { onboardingModelView, saveDefaultModel, type ModelChoice, type ModelPrefs } from "./wizard/assistant-model";

type AiStepText = {
  checking: string;
  ready: string;
  none: string;
  pick: string;
  unavailable: string;
  noWorkspace: string;
  open: string;
  continueReady: string;
  continueWithout: string;
  /** N-A5-8: poskytovateľ ani po `CHECK_LIMIT_MS` neodpovedá (sieť, proxy, certifikát). */
  unreachable: string;
  retry: string;
};

const aiStepText: Record<Language, AiStepText> = {
  sk: {
    checking: "Overujem pripojenie modelu…",
    ready: "Model je pripojený:",
    none: "Zatiaľ nemáte pripojený model. Pokračovať môžete aj bez neho, asistent však začne odpovedať až po pripojení modelu v nastaveniach AI.",
    pick: "Poskytovateľ je pripojený, ale model zatiaľ nie je vybraný. Vyberte ho v nastaveniach AI.",
    unavailable: "Vybraný model už nie je dostupný. Vyberte iný v nastaveniach AI.",
    noWorkspace: "Prostredie AI sa ešte nespustilo, preto sa model teraz nedá overiť. Pokračujte a model pripojte v Nastavenia → Poskytovatelia AI. Nastavenie platí pre všetky priečinky a priečinok na to nepotrebujete.",
    open: "Otvoriť nastavenia AI",
    continueReady: "Pokračovať",
    continueWithout: "Pokračovať bez modelu",
    unreachable: "Pripojenie k AI sa nepodarilo overiť: poskytovateľ ani po dlhšom čase neodpovedá. Skontrolujte internet (firemná sieť, VPN alebo proxy) a skúste znova. Pokračovať môžete aj bez AI a model pripojiť neskôr v nastaveniach.",
    retry: "Skúsiť znova",
  },
  cs: {
    checking: "Ověřuji připojení modelu…",
    ready: "Model je připojen:",
    none: "Zatím nemáte připojený model. Pokračovat můžete i bez něj, asistent ale začne odpovídat až po připojení modelu v nastavení AI.",
    pick: "Poskytovatel je připojen, ale model zatím není vybrán. Vyberte ho v nastavení AI.",
    unavailable: "Vybraný model už není dostupný. Vyberte jiný v nastavení AI.",
    noWorkspace: "Prostředí AI se ještě nespustilo, proto model teď nelze ověřit. Pokračujte a model připojte v Nastavení → Poskytovatelé AI. Nastavení platí pro všechny složky a složku k tomu nepotřebujete.",
    open: "Otevřít nastavení AI",
    continueReady: "Pokračovat",
    continueWithout: "Pokračovat bez modelu",
    unreachable: "Připojení k AI se nepodařilo ověřit: poskytovatel ani po delší době neodpovídá. Zkontrolujte internet (firemní síť, VPN nebo proxy) a zkuste to znovu. Pokračovat můžete i bez AI a model připojit později v nastavení.",
    retry: "Zkusit znovu",
  },
  en: {
    checking: "Checking the model connection…",
    ready: "Model connected:",
    none: "No model is connected yet. You can continue without one, but the assistant only answers once a model is connected in the AI settings.",
    pick: "A provider is connected, but no model is selected yet. Choose one in the AI settings.",
    unavailable: "The selected model is no longer available. Choose another one in the AI settings.",
    noWorkspace: "The AI environment has not started yet, so the model cannot be checked now. Continue, then connect a model in Settings → AI Providers. The setting applies to every folder and does not need one.",
    open: "Open AI settings",
    continueReady: "Continue",
    continueWithout: "Continue without a model",
    unreachable: "The AI connection could not be checked: the provider has not answered for a while. Check the internet connection (company network, VPN or proxy) and try again. You can also continue without AI and connect a model later in the settings.",
    retry: "Try again",
  },
  de: {
    checking: "Modellverbindung wird geprüft…",
    ready: "Modell verbunden:",
    none: "Noch ist kein Modell verbunden. Sie können ohne Modell fortfahren, der Assistent antwortet aber erst, wenn in den KI-Einstellungen ein Modell verbunden ist.",
    pick: "Ein Anbieter ist verbunden, aber noch kein Modell ausgewählt. Wählen Sie es in den KI-Einstellungen.",
    unavailable: "Das ausgewählte Modell ist nicht mehr verfügbar. Wählen Sie in den KI-Einstellungen ein anderes.",
    noWorkspace: "Die KI-Umgebung ist noch nicht gestartet, daher lässt sich das Modell jetzt nicht prüfen. Fahren Sie fort und verbinden Sie das Modell unter Einstellungen → KI-Provider. Die Einstellung gilt für alle Ordner und benötigt keinen Ordner.",
    open: "KI-Einstellungen öffnen",
    continueReady: "Weiter",
    continueWithout: "Ohne Modell fortfahren",
    unreachable: "Die KI-Verbindung ließ sich nicht prüfen: Der Anbieter antwortet seit längerer Zeit nicht. Prüfen Sie die Internetverbindung (Firmennetz, VPN oder Proxy) und versuchen Sie es erneut. Sie können auch ohne KI fortfahren und ein Modell später in den Einstellungen verbinden.",
    retry: "Erneut versuchen",
  },
};

/** `no-workspace`: no engine is reachable yet (not even the hidden home workspace, spec P8), so providers cannot be listed here. */
export type AiModelView = {
  state: ComposerModelState | "checking" | "no-workspace" | "unreachable";
  /** N-A5-8: znova overiť pripojenie, keď poskytovateľ neodpovedal (stav `unreachable`). */
  retry?: () => void;
  modelLabel?: string;
  /** Pripojení poskytovatelia (karty v kroku AI asistent, C1); bez enginu prázdne. */
  providers?: readonly { id: string; name: string }[];
  /** Modely pripojených poskytovateľov na zmenu v kroku AI asistent (N-A2-5). */
  choices?: readonly ModelChoice[];
  /** Vybraný model, keď je stav `ready`. */
  selected?: ModelRef;
  /** Pripojený poskytovateľ ponúka len bezplatné modely; s podkladmi klientov ich nepoužívame. */
  onlyFree?: boolean;
  /** Priestor, z ktorého zoznamu poskytovateľov stav pochádza (len po úspešnom načítaní). */
  workspaceId?: string;
};

/** Priečinok klienta, ktorého pripravenosť má krok čítať (krok 6: klient, s ktorým sa otvorí chat). */
export type OnboardingModelScope = { workspaceId?: string; directory?: string };

/**
 * Pure view of the AI step: model state, the way to AI settings and continue.
 * Bez voľby analytiky: analytika je v LAWOSS natrvalo vypnutá (`isAnalyticsChoiceHidden`).
 */
export function AiStepView({
  locale,
  model,
  busy,
  onOpenAiSettings,
  onContinue,
}: {
  locale: Language;
  model: AiModelView;
  busy: boolean;
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
    "no-workspace": text.noWorkspace,
    unreachable: text.unreachable,
  }[model.state];
  const ready = model.state === "ready";
  return (
    <>
      <AiGuidance locale={locale} />
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
        {model.retry ? <Button variant="outline" disabled={busy} onClick={model.retry}>{text.retry}</Button> : null}
        {model.state === "no-workspace" ? null : (
          <Button variant="outline" onClick={onOpenAiSettings}>
            <ExternalLink />
            {text.open}
          </Button>
        )}
        {onContinue ? (
          <Button disabled={busy || model.state === "checking"} onClick={onContinue}>
            {ready ? text.continueReady : text.continueWithout}
          </Button>
        ) : null}
      </div>
    </>
  );
}

type OpencodeTarget = { client: Client; baseUrl: string; directory: string; workspaceId: string };

/**
 * The OpenCode endpoint whose provider list the composer would read: the active
 * workspace, else the first local one. Null when no workspace exists yet; the
 * readiness then falls back exactly as the composer does before its query resolves.
 */
async function resolveOpencodeTarget(scope?: OnboardingModelScope): Promise<OpencodeTarget | null> {
  const connection = await resolveLegalworkConnection();
  if (!connection.normalizedBaseUrl || !(connection.resolvedToken || connection.resolvedHostToken)) return null;
  const server = createLegalworkServerClient({
    baseUrl: connection.normalizedBaseUrl,
    token: connection.resolvedToken || undefined,
    hostToken: connection.resolvedHostToken || undefined,
  });
  const list = await server.listWorkspaces();
  // Krok 6 číta priestor klienta, s ktorým sa otvorí chat (ten istý zoznam ako `prepareClientChat`).
  const directory = scope?.directory ? normalizeDirectoryPath(scope.directory) : "";
  const scoped = scope
    ? list.items.find((item) => item.id === scope.workspaceId) ?? (directory ? list.items.find((item) => normalizeDirectoryPath(item.path) === directory) : undefined)
    : undefined;
  const workspace =
    scoped ??
    preferRealWorkspace(list.items, list.activeId, (item) => item.id) ??
    list.items.find((item) => item.id === list.activeId);
  if (!workspace) return null;
  const endpoint = resolveWorkspaceEndpoint(workspace, {
    baseUrl: connection.normalizedBaseUrl,
    token: connection.resolvedToken,
  });
  if (!endpoint?.token) return null;
  const path = workspace.path?.trim() ?? "";
  return {
    client: createClient(endpoint.opencodeBaseUrl, path || undefined, { token: endpoint.token, mode: "legalwork" }),
    baseUrl: endpoint.opencodeBaseUrl,
    directory: path,
    workspaceId: workspace.id,
  };
}

/**
 * Stav kroku zo zoznamu poskytovateľov a uloženie automaticky vybraného modelu. Pripojený poskytovateľ
 * bez modelu: odporúčaný model sa uloží ako v Nastaveniach AI (N-A2-5), aby ho použil aj chat; rovnaký
 * model `withDefaultModel` nemení, takže sa to nezacyklí.
 */
export function useOnboardingModelView<P extends ModelPrefs>(defaultModel: ModelRef | null, list: ProviderListResponse | undefined, setPrefs: (updater: (previous: P) => P) => void): AiModelView {
  const { view, auto } = onboardingModelView(defaultModel, list);
  useEffect(() => {
    saveDefaultModel(setPrefs, auto);
  }, [auto?.providerID, auto?.modelID, setPrefs]);
  return view;
}

/**
 * N-A5-8 (test 25. 10. 2026): keď poskytovateľ neodpovedá (sieť, proxy, certifikát), krok 4 ukazoval „Overujem
 * pripojenie…“ viac ako 10 minút. Po tomto čase (alebo pri chybe zoznamu poskytovateľov) povie, že pripojenie sa
 * nepodarilo overiť, čo skúsiť a ponúkne „Skúsiť znova“.
 */
export const CHECK_LIMIT_MS = 20_000;

/** Stav overovania s časovým limitom: `checking` najviac `CHECK_LIMIT_MS` (`expired`), potom alebo pri chybe `unreachable` s opakovaním. */
export function boundedCheck(view: AiModelView, checking: boolean, failed: boolean, expired: boolean, retry: () => void): AiModelView {
  if (failed || (checking && expired)) return { state: "unreachable", retry };
  return checking ? { state: "checking" } : view;
}

export function useOnboardingModel(scope?: OnboardingModelScope): AiModelView {
  const local = useLocal();
  // `failed`: priestor sa nepodarilo zistiť (vypršaný čas, sieť), nie „žiadny priestor“ (review N-A5-8).
  const [target, setTarget] = useState<OpencodeTarget | null | undefined | "failed">(undefined);
  const [attempt, setAttempt] = useState(0);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), CHECK_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [scope?.workspaceId, scope?.directory, attempt]);
  useEffect(() => {
    let cancelled = false;
    setTarget(undefined);
    void resolveOpencodeTarget(scope)
      .catch((): "failed" => "failed")
      .then((value) => {
        if (!cancelled) setTarget(value);
      });
    return () => {
      cancelled = true;
    };
  }, [scope?.workspaceId, scope?.directory, attempt]);
  const resolved = target === undefined || target === null || target === "failed" ? null : target;
  const query = useProviderListQuery({
    client: resolved?.client ?? null,
    baseUrl: resolved?.baseUrl,
    directory: resolved?.directory,
  });
  const view = useOnboardingModelView(local.prefs.defaultModel, resolved ? query.data : undefined, local.setPrefs);
  const retry = () => {
    setAttempt((value) => value + 1);
    // Zoznam poskytovateľov len pri zistenom priestore; inak ho obnoví nové zistenie priestoru.
    if (resolved) void query.refetch();
  };
  return onboardingCheckView({
    target: target === undefined ? "pending" : target === null ? "none" : target === "failed" ? "failed" : "found",
    pending: query.isPending, failed: query.isError && !query.data, expired,
  }, query.data && resolved ? { ...view, workspaceId: resolved.workspaceId } : view, retry);
}

/**
 * Stav kroku zo zistenia priestoru a zoznamu poskytovateľov: priestor sa zisťuje (`pending`), nie je (`none`),
 * nepodarilo sa ho zistiť (`failed`, vypršaný čas pri štarte) alebo je (`found`). Nezistený priestor nie je
 * „žiadny priestor“: povie, že pripojenie sa nepodarilo overiť, a ponúkne opakovanie (review N-A5-8).
 */
export function onboardingCheckView(input: { target: "pending" | "none" | "failed" | "found"; pending: boolean; failed: boolean; expired: boolean }, view: AiModelView, retry: () => void): AiModelView {
  if (input.target === "none") return { state: "no-workspace" };
  const checking = input.target === "pending" || (input.target === "found" && input.pending);
  const failed = input.target === "failed" || (input.target === "found" && input.failed);
  return boundedCheck(view, checking, failed, input.expired, retry);
}

/** Zmena modelu v kroku AI asistent: uloží sa ako predvolený model v Nastaveniach AI. */
export function useOnboardingModelSelect(): (model: ModelRef) => void {
  const { setPrefs } = useLocal();
  return (model) => saveDefaultModel(setPrefs, model);
}

/** AI step with live state. */
export function OnboardingAiPanel(props: {
  locale: Language;
  busy: boolean;
  onOpenAiSettings: () => void;
  onContinue?: () => void;
}) {
  const model = useOnboardingModel();
  return <AiStepView {...props} model={model} />;
}
