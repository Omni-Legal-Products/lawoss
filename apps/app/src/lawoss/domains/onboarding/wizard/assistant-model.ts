/**
 * Model v kroku „Váš AI asistent“ bez Reactu (N-A2-5, rozhodnutie MČ 23. 10. 2026).
 *
 * Po pripojení poskytovateľa krok hlásil „Model nie je vybraný“ a výber nemal: model vyberá až
 * session-route (`getDefaultModelForSingleConnectedProvider`), ktorý počas onboardingu nebeží.
 * Krok preto vyberie predvolený model poskytovateľa podľa toho istého pravidla a uloží ho tak ako
 * Nastavenia AI (`defaultModel`, variant sa pri inom modeli vynuluje). Zmeniť ho ide v malom výbere.
 */
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import type { ModelRef, ProviderListItem } from "@/app/types";
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

type ProviderModel = ProviderListItem["models"][string];

const FREE_VARIANT = /:free$/i;
/** Zdroje s cenníkom katalógu (API kľúč, premenná prostredia): nulová cena tam znamená bezplatný koncový bod. */
const PRICED_SOURCES: ReadonlySet<ProviderListItem["source"]> = new Set(["api", "env"]);

/**
 * Bezplatný model, ktorý nepatrí k podkladom klientov (AGENTS.md: „Do not use upstream free models
 * with client, privileged, or matter data“; review PR #226). Appka iný predikát nemá (`isFree` vo výbere
 * modelov je vždy `false`), okrem ukončených bezplatných poskytovateľov (`RETIRED_FREE_PROVIDER_IDS`).
 * - Variant `:free` (OpenRouter a podobní) v kľúči, `id` alebo `api.id`.
 * - Nulová cena vstupu aj výstupu len pri poskytovateľovi s cenníkom katalógu (`api`, `env`). Predplatné
 *   cez OAuth (ChatGPT, zdroj `custom`) a vlastné či lokálne modely (`config`, `custom`) majú v OpenCode
 *   cenu 0 bez toho, aby boli verejným bezplatným koncovým bodom; tie ostávajú.
 */
export function isFreeModel(provider: Pick<ProviderListItem, "source">, modelID: string, model: ProviderModel): boolean {
  if ([modelID, model.id, model.api?.id].some((id) => typeof id === "string" && FREE_VARIANT.test(id))) return true;
  const cost = model.cost;
  return PRICED_SOURCES.has(provider.source) && cost !== undefined && cost.input === 0 && cost.output === 0;
}

/** Zoznam poskytovateľov bez bezplatných modelov; z neho krok 4 vyberá, ponúka aj hodnotí pripravenosť. */
export function withoutFreeModels(list: ProviderListResponse | null | undefined): ProviderListResponse | null | undefined {
  if (!list) return list;
  return {
    ...list,
    all: list.all.map((provider) => ({
      ...provider,
      models: Object.fromEntries(Object.entries(provider.models ?? {}).filter(([modelID, model]) => !isFreeModel(provider, modelID, model))),
    })),
  };
}

/** Pripojený poskytovateľ má modely pre asistenta, ale všetky sú bezplatné. */
function onlyFreeModels(list: ProviderListResponse | null | undefined): boolean {
  const capable = connectedProviders(list).flatMap((provider) =>
    Object.entries(provider.models ?? {}).filter(([modelID, model]) => isAgentCapableModel(modelID, model)).map(([modelID, model]) => ({ provider, modelID, model })),
  );
  return capable.length > 0 && capable.every(({ provider, modelID, model }) => isFreeModel(provider, modelID, model));
}

/**
 * Model, ktorý krok vyberie sám: len keď je poskytovateľ pripojený a **žiadny** model nie je vybraný
 * (`pick-model`). Pravidlo je to isté ako v rozhovore (jeden pripojený poskytovateľ, jeho odporúčaný model
 * s nástrojmi); pri viacerých poskytovateľoch nevyberá a advokát si model zvolí sám.
 *
 * Vybraný, no v tomto zozname nedostupný model (`unavailable`) sa neprepisuje: zoznam môže byť z iného
 * priečinka (onboarding číta aktívny priestor), kde vlastný poskytovateľ advokáta chýba. Krok ukáže výber.
 */
export function onboardingAutoModel(defaultModel: ModelRef | null | undefined, source: ProviderListResponse | null | undefined): ModelRef | null {
  // Bezplatné modely sa nikdy nevyberú samy (ani ako odporúčaný model poskytovateľa).
  const list = withoutFreeModels(source);
  if (!list) return null;
  const state = composerModelState(onboardingModelReadiness(defaultModel, list));
  if (state !== "pick-model") return null;
  const model = getDefaultModelForSingleConnectedProvider(list);
  return model && composerModelState(onboardingModelReadiness(model, list)) === "ready" ? model : null;
}

/** Modely pripojených poskytovateľov, s ktorými asistent vie pracovať (nástroje, nie obrázky či reč). */
export function onboardingModelChoices(list: ProviderListResponse | null | undefined): ModelChoice[] {
  const providers = connectedProviders(list);
  return providers.flatMap((provider) =>
    Object.entries(provider.models ?? {})
      .filter(([modelID, model]) => isAgentCapableModel(modelID, model) && !isFreeModel(provider, modelID, model))
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

/** Časť nastavení s predvoleným modelom (`LocalPreferences`). */
export type ModelPrefs = { defaultModel: ModelRef | null; modelVariant: string | null };

/** Zápis do nastavení (`useLocal().setPrefs`) pre automatický výber aj zmenu vo výbere; bez modelu nič. */
export function saveDefaultModel<P extends ModelPrefs>(setPrefs: (updater: (previous: P) => P) => void, model: ModelRef | null): void {
  if (model) setPrefs((previous) => withDefaultModel(previous, model));
}

/**
 * Stav kroku z uloženého modelu a zoznamu poskytovateľov. Kým sa automatický výber uloží, krok už
 * ukazuje vybraný model (žiadne „Model nie je vybraný“ na jeden snímok); `auto` treba uložiť.
 */
export function onboardingModelView(defaultModel: ModelRef | null | undefined, source: ProviderListResponse | null | undefined): { view: AiModelView; auto: ModelRef | null } {
  const auto = onboardingAutoModel(defaultModel, source);
  // Pripravenosť len z modelov, ktoré smú pracovať s podkladmi klientov: uložený bezplatný model nie je pripravený.
  const list = withoutFreeModels(source);
  const readiness = onboardingModelReadiness(auto ?? defaultModel, list);
  const state = composerModelState(readiness);
  const connected = getConnectedProviderItems(list);
  const providers = connected.map((provider) => ({ id: provider.id, name: provider.name }));
  const choices = onboardingModelChoices(list);
  if (state !== "ready") return { view: { state, providers, choices, ...(onlyFreeModels(source) ? { onlyFree: true } : {}) }, auto };
  const selected = readiness.selectedModel;
  const modelLabel = formatModelLabel(selected, connected);
  // Platný uložený model mimo ponuky (napr. bez príznaku nástrojov v katalógu) ostane vo výbere vybraný.
  const listed = choices.some((choice) => sameModel(choice, selected));
  return {
    view: { state, modelLabel, providers, choices: listed ? choices : [{ ...selected, label: modelLabel }, ...choices], selected },
    auto,
  };
}
