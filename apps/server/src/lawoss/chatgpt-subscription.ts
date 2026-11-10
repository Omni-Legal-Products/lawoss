// tsc consumes the portable declaration; Bun bundles the implementation for Node.
// Tie isté pravidlá ako zoznam poskytovateľov v appke (apps/app/src/lawoss/providers/subscription-models.ts).
import { isChatgptSubscription, nativeConnectionSource, recommendedSubscriptionModel, subscriptionModels } from "../../../../lawoss/providers/chatgpt-subscription.mjs";

type ProviderWithModels<M> = { id: string; source?: string; models: Record<string, M> };

/**
 * Modely poskytovateľa, ktoré môže ponúknuť automatický výber: pri predplatnom ChatGPT len
 * tie, ktoré účet prijme, a odporúčaná Luna ako prvá. Ostatní poskytovatelia bez zmeny.
 */
export function offeredModels<M extends { id: string }>(provider: ProviderWithModels<M>): M[] {
  if (!isChatgptSubscription(provider)) return Object.values(provider.models);
  const offered = subscriptionModels(provider);
  const recommended = recommendedSubscriptionModel(offered);
  return Object.values(offered).sort((a, b) => Number(b.id === recommended) - Number(a.id === recommended));
}

type IntegrationWithConnections = { id: string; connections: ReadonlyArray<{ type: "credential"; method: string } | { type: "env"; name?: string }> };

/**
 * Zdroj poskytovateľa enginu v2 v tvare 1.x (`custom` = predplatné ChatGPT): engine 2.1.4 pole `source` nemá,
 * rozhoduje aktívne pripojenie jeho integrácie (to isté pravidlo ako zoznam poskytovateľov v appke).
 */
export function providerSource(provider: { id: string; integrationID?: string }, integrations: readonly IntegrationWithConnections[]): string {
  return nativeConnectionSource(integrations.find(integration => integration.id === (provider.integrationID ?? provider.id)));
}
