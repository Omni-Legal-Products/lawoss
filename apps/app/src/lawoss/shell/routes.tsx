/** @jsxImportSource react */
import type { ReactElement } from "react";

import { ExperimentyPage } from "../domains/experimenty/experimenty-page";
import { NativeIntegrationsRedirect } from "../domains/marketplace/native-redirect";
import { LehotyPage } from "../domains/lehoty/lehoty-page";
import { NovySpisPage } from "../domains/novy-spis/novy-spis-page";
import { PrehladPage } from "../domains/prehlad/prehlad-page";
import { SpisPage } from "../domains/spis/spis-page";
import { PrveNastaveniePage } from "../domains/onboarding/prve-nastavenie-page";

/**
 * LAWOSS routes (fáza B) — mapped directly in the upstream app-root
 * (`LAWOSS_ROUTES.map(...)`, one 🟡 block) so upstream fallbacks keep working.
 */
export const LAWOSS_ROUTES: ReadonlyArray<{ path: string; element: ReactElement }> = [
  { path: "/prehlad", element: <PrehladPage /> },
  { path: "/spis", element: <SpisPage /> },
  { path: "/lehoty", element: <LehotyPage /> },
  { path: "/konektory", element: <NativeIntegrationsRedirect from="/konektory" /> },
  { path: "/marketplace", element: <NativeIntegrationsRedirect from="/marketplace" /> },
  { path: "/experimenty", element: <ExperimentyPage /> },
  { path: "/experimenty/novy-spis", element: <NovySpisPage /> },
  { path: "/experimenty/prve-nastavenie", element: <PrveNastaveniePage /> },
];
