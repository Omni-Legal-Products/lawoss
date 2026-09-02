/** Šablóny OKF v0.1 (autor MČ, prevzaté zo skillu novy-spis) ako text — pre CLI a testy. */
import klientAgents from "../templates/klient/AGENTS.md" with { type: "text" };
import klientMemory from "../templates/klient/MEMORY.md" with { type: "text" };
import klientCard from "../templates/klient/klient.md" with { type: "text" };
import spisAgents from "../templates/spis/AGENTS.md" with { type: "text" };
import spisMemory from "../templates/spis/MEMORY.md" with { type: "text" };
import spisStatus from "../templates/spis/_STATUS.md" with { type: "text" };
import spisCard from "../templates/spis/spis.md" with { type: "text" };
import projektAgents from "../templates/projekt/AGENTS.md" with { type: "text" };
import projektMemory from "../templates/projekt/MEMORY.md" with { type: "text" };
import projektCard from "../templates/projekt/projekt.md" with { type: "text" };

import type { TemplateSet } from "./core.ts";

export const TEMPLATES: TemplateSet = {
  klient: { "klient.md": klientCard, "AGENTS.md": klientAgents, "MEMORY.md": klientMemory },
  spis: { "spis.md": spisCard, "_STATUS.md": spisStatus, "AGENTS.md": spisAgents, "MEMORY.md": spisMemory },
  projekt: { "projekt.md": projektCard, "AGENTS.md": projektAgents, "MEMORY.md": projektMemory },
};
