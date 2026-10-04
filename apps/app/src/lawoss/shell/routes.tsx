/** @jsxImportSource react */
import type { ReactElement } from "react";
import { t } from "@/i18n";

import { ExperimentyPage } from "../domains/experimenty/experimenty-page";
import { NativeIntegrationsRedirect } from "../domains/marketplace/native-redirect";
import { LehotyPage } from "../domains/lehoty/lehoty-page";
import { NovySpisPage } from "../domains/novy-spis/novy-spis-page";
import { PrehladPage } from "../domains/prehlad/prehlad-page";
import { SpisPage } from "../domains/spis/spis-page";
import { PrveNastaveniePage } from "../domains/onboarding/prve-nastavenie-page";
import { TodayPage } from "../lite/pages/today-page";
import { ClientsPage } from "../lite/pages/clients-page";
import { LiteMatterPage } from "../lite/pages/matter-page";
import { LITE_CLIENTS_PATH, LITE_MATTER_PATH, LITE_TODAY_PATH } from "../lite/links";

/**
 * LAWOSS routes (fáza B) — mapped directly in the upstream app-root
 * (`LAWOSS_ROUTES.map(...)`, one 🟡 block) so upstream fallbacks keep working.
 */
export const LAWOSS_ROUTES: ReadonlyArray<{ path: string; element: ReactElement; title?: string }> = [
  { path: "/prehlad", element: <PrehladPage />, title: "lawoss.shell.overview" },
  { path: "/spis", element: <SpisPage />, title: "lawoss.shell.matter" },
  { path: "/lehoty", element: <LehotyPage />, title: "lawoss.shell.deadlines" },
  { path: "/konektory", element: <NativeIntegrationsRedirect from="/konektory" /> },
  { path: "/marketplace", element: <NativeIntegrationsRedirect from="/marketplace" /> },
  { path: "/experimenty", element: <ExperimentyPage />, title: "lawoss.shell.experiments" },
  { path: "/experimenty/novy-spis", element: <NovySpisPage />, title: "lawoss.shell.new_matter" },
  { path: "/experimenty/prve-nastavenie", element: <PrveNastaveniePage />, title: "lawoss.shell.setup" },
  // LAWOSS-lite - dostupné v obou režimech, v lite jsou výchozí navigací.
  { path: LITE_TODAY_PATH, element: <TodayPage />, title: "lawoss.lite.nav_today" },
  { path: LITE_CLIENTS_PATH, element: <ClientsPage />, title: "lawoss.lite.nav_clients" },
  { path: LITE_MATTER_PATH, element: <LiteMatterPage />, title: "lawoss.lite.nav_clients" },
];

/** Header title for a LAWOSS screen in the shared shell, so it never reads as a chat. */
export function lawossRouteTitle(pathname: string): string | undefined {
  const key = LAWOSS_ROUTES.find((route) => route.path === pathname)?.title;
  return key ? t(key) : undefined;
}
