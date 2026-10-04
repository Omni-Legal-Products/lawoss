import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import type { ModelRef } from "@/app/types";
import {
  countConnectedProviders,
  isModelAvailableInConnectedProviders,
  RETIRED_FREE_PROVIDER_IDS,
} from "@/react-app/infra/provider-list-query";

/**
 * Model state of the composer, computed once for every surface that shows it.
 *
 * `session-route` passes `providerConnectedCount` and `modelUnavailable` from
 * here to the composer, whose "no model" notice reads them; the onboarding AI
 * step reads the same values. Before the provider list resolves, the count
 * falls back to the separately tracked connected ids and nothing is reported
 * unavailable, exactly as the composer behaves on a cold start.
 */
export type ModelReadiness = {
  selectedModel: ModelRef;
  modelUnavailable: boolean;
  hasUsableModel: boolean;
  providerConnectedCount: number;
};

export function modelReadiness(input: {
  defaultModel: ModelRef | null | undefined;
  providerList: ProviderListResponse | null | undefined;
  disabledProviderIds?: string[];
  fallbackConnectedCount?: number;
}): ModelReadiness {
  const { defaultModel, providerList } = input;
  const modelUnavailable = Boolean(
    defaultModel && providerList && !isModelAvailableInConnectedProviders(providerList, defaultModel),
  );
  const hasUsableModel = Boolean(defaultModel && !modelUnavailable);
  // A usable selection guarantees a connected provider even before the query
  // resolves on a cold start.
  const providerConnectedCount = hasUsableModel
    ? 1
    : providerList
      ? countConnectedProviders(providerList, input.disabledProviderIds ?? [])
      : (input.fallbackConnectedCount ?? 0);
  return {
    selectedModel: defaultModel ?? { providerID: "", modelID: "" },
    modelUnavailable,
    hasUsableModel,
    providerConnectedCount,
  };
}

/**
 * Which "no model" state the composer shows for a readiness, without the
 * Eigenwelt plan and trial variants LAWOSS hides (`session-surface.tsx`:
 * `noModelNoticeVisible`, `lockedOutCandidate`, `pickModelNoticeVisible`).
 * `unavailable` covers a selection that is gone while another provider is
 * still connected, which the composer marks as an unavailable model.
 */
export type ComposerModelState = "ready" | "no-model" | "pick-model" | "unavailable";

export function composerModelState(readiness: ModelReadiness): ComposerModelState {
  const noModelNoticeVisible = !readiness.selectedModel.providerID;
  if (noModelNoticeVisible) return readiness.providerConnectedCount > 0 ? "pick-model" : "no-model";
  return readiness.modelUnavailable ? "unavailable" : "ready";
}

const isRetiredFreeProvider = (providerID: string) => RETIRED_FREE_PROVIDER_IDS.has(providerID.trim().toLowerCase());

/**
 * Readiness for the onboarding AI step. The retired free tier ("opencode",
 * "eigenwelt-free") is never a model: a stored selection on it counts as none
 * (session-route clears it on its own, onboarding runs before that) and a
 * connected retired provider is not counted.
 */
export function onboardingModelReadiness(
  defaultModel: ModelRef | null | undefined,
  providerList: ProviderListResponse | null | undefined,
): ModelReadiness {
  return modelReadiness({
    defaultModel: defaultModel && !isRetiredFreeProvider(defaultModel.providerID) ? defaultModel : null,
    providerList,
    disabledProviderIds: [...RETIRED_FREE_PROVIDER_IDS],
  });
}
