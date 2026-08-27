/** @jsxImportSource react */
import type { ReactElement } from "react";

import { KonektoryPage } from "../domains/konektory/konektory-page";
import { LehotyPage } from "../domains/lehoty/lehoty-page";
import { MarketplacePage } from "../domains/marketplace/marketplace-page";
import { PrehladPage } from "../domains/prehlad/prehlad-page";

/**
 * LAWOSS routes (fáza B) — mapped directly in the upstream app-root
 * (`LAWOSS_ROUTES.map(...)`, one 🟡 block) so upstream fallbacks keep working.
 */
export const LAWOSS_ROUTES: ReadonlyArray<{ path: string; element: ReactElement }> = [
  { path: "/prehlad", element: <PrehladPage /> },
  { path: "/lehoty", element: <LehotyPage /> },
  { path: "/konektory", element: <KonektoryPage /> },
  { path: "/marketplace", element: <MarketplacePage /> },
];
