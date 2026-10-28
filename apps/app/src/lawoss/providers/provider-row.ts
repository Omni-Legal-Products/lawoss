import { t } from "@/i18n";
import { isChatgptSubscription } from "./subscription-models";

type ListedProvider = { id: string; source?: string; options?: unknown };

const hasBaseURL = (provider: ListedProvider): boolean => {
  const options = provider.options;
  if (!options || typeof options !== "object" || !("baseURL" in options)) return false;
  return typeof options.baseURL === "string" && options.baseURL.trim().length > 0;
};

/**
 * Riadok pripojeného poskytovateľa v Nastaveniach → Poskytovatelia AI (nález N-A7-12).
 *
 * „Upraviť“ otvára formulár vlastného poskytovateľa, ktorý číta a ukladá blok
 * `provider.<id>` s adresou `options.baseURL` (`readCustomProviderForEdit`,
 * `submitCustomProvider` v `provider-auth/store.ts`). Upstream ho ponúkal aj pri zdroji
 * `custom`, lenže ten OpenCode 1.18.29 dáva poskytovateľom, ktorých pripojí loader
 * pluginu z prihlásenia (OpenAI cez predplatné ChatGPT, pozri
 * `lawoss/providers/chatgpt-subscription.mjs`). Takí poskytovatelia blok v konfigurácii
 * ani adresu nemajú, takže „Upraviť“ skončilo hláškou, že sa konfigurácia nedá načítať.
 * Upraviť sa preto dá len poskytovateľ s vlastnou adresou; ostatným ostáva „Odpojiť“.
 *
 * Zdroj `custom` sa v upstream riadku ukazuje ako „Vlastné“; pri predplatnom ChatGPT
 * bez vlastnej adresy dostane riadok výstižnejší popis.
 */
export function lawossProviderRow(provider: ListedProvider): { editableAsCustom: boolean; sourceLabel?: string } {
  return {
    editableAsCustom: hasBaseURL(provider),
    ...(isChatgptSubscription(provider) && !hasBaseURL(provider) ? { sourceLabel: t("lawoss.providers.chatgpt_subscription") } : {}),
  };
}
