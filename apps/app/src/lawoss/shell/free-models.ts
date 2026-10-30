/** Jeden predikát pre krok 4 onboardingu, pripravenosť modelu (`modelReadiness`) aj automatický výber (`pickDefaultModel`), #231. */
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import type { ProviderListItem } from "@/app/types";

type ProviderModel = ProviderListItem["models"][string];

const FREE_VARIANT = /:free$/i;
/** Zdroje s cenníkom katalógu (API kľúč, premenná prostredia): nulová cena tam znamená bezplatný koncový bod. */
const PRICED_SOURCES: ReadonlySet<ProviderListItem["source"]> = new Set(["api", "env"]);

/** Variant `:free` sa dá odmietnuť aj bez katalógu (studený štart, zlyhané načítanie poskytovateľov). */
export const isFreeVariantId = (id: unknown): boolean => typeof id === "string" && FREE_VARIANT.test(id);

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
  if ([modelID, model.id, model.api?.id].some(isFreeVariantId)) return true;
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
