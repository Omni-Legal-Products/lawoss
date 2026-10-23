/**
 * Model v kroku „Váš AI asistent“ bez Reactu (N-A2-5, rozhodnutie MČ 23. 10. 2026).
 *
 * Po pripojení poskytovateľa krok hlásil „Model nie je vybraný“ a výber nemal: model vyberá až
 * session-route (`getDefaultModelForSingleConnectedProvider`), ktorý počas onboardingu nebeží.
 * Krok preto vyberie predvolený model poskytovateľa podľa toho istého pravidla a uloží ho tak ako
 * Nastavenia AI (`defaultModel`, variant sa pri inom modeli vynuluje). Zmeniť ho ide v malom výbere.
 */
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import type { ModelRef } from "@/app/types";
import { formatModelLabel } from "@/app/utils";
import {
  getConnectedProviderItems,
  getDefaultModelForSingleConnectedProvider,
  RETIRED_FREE_PROVIDER_IDS,
} from "@/react-app/infra/provider-list-query";
import { isAgentCapableModel } from "../../../shell/default-model-pick";
import { composerModelState, onboardingModelReadiness } from "../../../shell/model-readiness";
import type { AiModelView } from "../ai-step";

/** Položka výberu modelu: odkaz na model a čitateľný názov. */
export type ModelChoice = ModelRef & { label: string };

const sameModel = (a: ModelRef | null | undefined, b: ModelRef | null | undefined): boolean =>
  Boolean(a && b && a.providerID === b.providerID && a.modelID === b.modelID);

const connectedProviders = (list: ProviderListResponse | null | undefined) =>
  getConnectedProviderItems(list).filter((provider) => !RETIRED_FREE_PROVIDER_IDS.has(provider.id));

/**
 * Model, ktorý krok vyberie sám: len keď je poskytovateľ pripojený a model chýba alebo už nie je
 * dostupný. Pravidlo je to isté ako v rozhovore (jeden pripojený poskytovateľ, jeho odporúčaný model
 * s nástrojmi); pri viacerých poskytovateľoch nevyberá a advokát si model zvolí sám.
 */
export function onboardingAutoModel(defaultModel: ModelRef | null | undefined, list: ProviderListResponse | null | undefined): ModelRef | null {
  if (!list) return null;
  const state = composerModelState(onboardingModelReadiness(defaultModel, list));
  if (state !== "pick-model" && state !== "unavailable") return null;
  const model = getDefaultModelForSingleConnectedProvider(list);
  return model && composerModelState(onboardingModelReadiness(model, list)) === "ready" ? model : null;
}

/** Modely pripojených poskytovateľov, s ktorými asistent vie pracovať (nástroje, nie obrázky či reč). */
export function onboardingModelChoices(list: ProviderListResponse | null | undefined): ModelChoice[] {
  const providers = connectedProviders(list);
  return providers.flatMap((provider) =>
    Object.entries(provider.models ?? {})
      .filter(([modelID, model]) => isAgentCapableModel(modelID, model))
      .map(([modelID, model]) => {
        const name = model.name || modelID;
        return { providerID: provider.id, modelID, label: providers.length > 1 ? `${provider.name} · ${name}` : name };
      }),
  );
}

/** Uloženie predvoleného modelu rovnako ako Nastavenia AI; ten istý model nič nemení. */
export function withDefaultModel<P extends ModelPrefs>(previous: P, next: ModelRef): P {
  if (sameModel(previous.defaultModel, next)) return previous;
  return { ...previous, defaultModel: { providerID: next.providerID, modelID: next.modelID }, modelVariant: null };
}

type ModelPrefs = { defaultModel: ModelRef | null; modelVariant: string | null };

/** Zápis do nastavení (`useLocal().setPrefs`) pre automatický výber aj zmenu vo výbere; bez modelu nič. */
export function saveDefaultModel<P extends ModelPrefs>(setPrefs: (updater: (previous: P) => P) => void, model: ModelRef | null): void {
  if (model) setPrefs((previous) => withDefaultModel(previous, model));
}

/**
 * Stav kroku z uloženého modelu a zoznamu poskytovateľov. Kým sa automatický výber uloží, krok už
 * ukazuje vybraný model (žiadne „Model nie je vybraný“ na jeden snímok); `auto` treba uložiť.
 */
export function onboardingModelView(defaultModel: ModelRef | null | undefined, list: ProviderListResponse | null | undefined): { view: AiModelView; auto: ModelRef | null } {
  const auto = onboardingAutoModel(defaultModel, list);
  const readiness = onboardingModelReadiness(auto ?? defaultModel, list);
  const state = composerModelState(readiness);
  const connected = getConnectedProviderItems(list);
  const providers = connected.map((provider) => ({ id: provider.id, name: provider.name }));
  const choices = onboardingModelChoices(list);
  if (state !== "ready") return { view: { state, providers, choices }, auto };
  return {
    view: { state, modelLabel: formatModelLabel(readiness.selectedModel, connected), providers, choices, selected: readiness.selectedModel },
    auto,
  };
}
