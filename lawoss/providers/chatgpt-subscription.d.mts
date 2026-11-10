type ProviderLike = { id: string; source?: string; models?: Record<string, unknown> };
type ModelLike = { id?: string; modelID?: string; api?: { id?: string } } | null | undefined;
type IntegrationLike = { connections?: ReadonlyArray<{ type: "credential"; method: string } | { type: "env"; name?: string }> } | null | undefined;

export const CHATGPT_SUBSCRIPTION_MODELS: ReadonlySet<string>;
export const CHATGPT_RECOMMENDED_MODELS: readonly string[];
export function nativeConnectionSource(integration: IntegrationLike): "custom" | "api" | "env" | "config";
export function isChatgptSubscription(provider: { id: string; source?: string } | null | undefined): boolean;
export function isSubscriptionModel(key: string, model: ModelLike): boolean;
export function subscriptionModels<P extends ProviderLike>(provider: P): NonNullable<P["models"]>;
export function recommendedSubscriptionModel(models: Record<string, unknown> | null | undefined): string | undefined;
