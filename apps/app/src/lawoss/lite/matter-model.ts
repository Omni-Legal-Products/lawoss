/**
 * Detail veci vopred povie, že rýchle akcie potrebujú model (P0-6, U7).
 *
 * Alfa nemá predvolený model (M9), takže prvá rýchla akcia väčšiny testerov skončila
 * všeobecnou chybou „Rozhovor sa nepodarilo otvoriť“. Stav sa číta z rovnakého zoznamu
 * poskytovateľov a rovnakých pravidiel ako composer a krok AI v onboardingu.
 */
import { useMemo } from "react";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import type { ModelRef } from "@/app/types";
import { createClient } from "@/app/lib/opencode";
import { resolveWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { getDefaultModelForSingleConnectedProvider, useProviderListQuery } from "@/react-app/infra/provider-list-query";
import { useOptionalLocal } from "@/react-app/kernel/local-provider";
import { composerModelState, onboardingModelReadiness } from "../shell/model-readiness";
import type { OkfConnection } from "../okf/connection";
import { officeWorkspace } from "../okf/read-model";

/** Čo rýchlym akciám chýba; `null` znamená, že môžu bežať (alebo sa to ešte nevie). */
export type MatterModelGap = "no-model" | "pick-model" | "unavailable";

/** Nastavenia AI, kde sa model pripája a vyberá (v lite smerujú do kancelárie). */
export const AI_SETTINGS_PATH = "/settings/ai";

/**
 * Chýbajúci model pre rýchle akcie. Kým zoznam poskytovateľov nie je načítaný, nič
 * neblokuje. Pri jednom pripojenom poskytovateľovi composer vyberie model sám
 * (`getDefaultModelForSingleConnectedProvider` v session-route), vtedy akcia prejde.
 */
export function matterModelGap(defaultModel: ModelRef | null | undefined, list: ProviderListResponse | null | undefined): MatterModelGap | null {
  if (!list) return null;
  const state = composerModelState(onboardingModelReadiness(defaultModel, list));
  if (state === "ready") return null;
  const automatic = getDefaultModelForSingleConnectedProvider(list);
  if (automatic && composerModelState(onboardingModelReadiness(automatic, list)) === "ready") return null;
  return state;
}

/** Zoznam poskytovateľov kancelárie, z ktorého číta aj composer. */
export function useMatterModelGap(connection: OkfConnection | null): MatterModelGap | null {
  const local = useOptionalLocal();
  const office = officeWorkspace(connection);
  const baseUrl = connection?.baseUrl ?? "";
  const token = connection?.token ?? "";
  const target = useMemo(() => {
    if (!office) return null;
    const endpoint = resolveWorkspaceEndpoint(office, { baseUrl, token });
    if (!endpoint?.token) return null;
    const directory = office.path?.trim() ?? "";
    return {
      client: createClient(endpoint.opencodeBaseUrl, directory || undefined, { token: endpoint.token, mode: "legalwork" }),
      baseUrl: endpoint.opencodeBaseUrl,
      directory,
    };
  }, [office, baseUrl, token]);
  const query = useProviderListQuery({ client: target?.client ?? null, baseUrl: target?.baseUrl, directory: target?.directory });
  // Bez kontextu nastavení alebo spojenia nevieme nič isté; neblokovať.
  if (!local || !target) return null;
  return matterModelGap(local.prefs.defaultModel, query.data);
}
