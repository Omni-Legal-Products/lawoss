// tsc consumes the portable declaration; Bun bundles the implementation for Node.
// Tie isté pravidlá ako zoznam poskytovateľov v appke (apps/app/src/lawoss/providers/subscription-models.ts).
import { isChatgptSubscription, recommendedSubscriptionModel, subscriptionModels } from "../../../../lawoss/providers/chatgpt-subscription.mjs";

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
