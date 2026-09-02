/** Šablóny OKF pre appku — tie isté súbory ako CLI, načítané cez Vite `?raw`. */
import klientAgents from "../../../../../lawoss/okf/templates/klient/AGENTS.md?raw";
import klientMemory from "../../../../../lawoss/okf/templates/klient/MEMORY.md?raw";
import klientCard from "../../../../../lawoss/okf/templates/klient/klient.md?raw";
import spisAgents from "../../../../../lawoss/okf/templates/spis/AGENTS.md?raw";
import spisMemory from "../../../../../lawoss/okf/templates/spis/MEMORY.md?raw";
import spisStatus from "../../../../../lawoss/okf/templates/spis/_STATUS.md?raw";
import spisCard from "../../../../../lawoss/okf/templates/spis/spis.md?raw";
import projektAgents from "../../../../../lawoss/okf/templates/projekt/AGENTS.md?raw";
import projektMemory from "../../../../../lawoss/okf/templates/projekt/MEMORY.md?raw";
import projektCard from "../../../../../lawoss/okf/templates/projekt/projekt.md?raw";

import type { TemplateSet } from "../../../../../lawoss/okf/src/core";

export const OKF_TEMPLATES: TemplateSet = {
  klient: { "klient.md": klientCard, "AGENTS.md": klientAgents, "MEMORY.md": klientMemory },
  spis: { "spis.md": spisCard, "_STATUS.md": spisStatus, "AGENTS.md": spisAgents, "MEMORY.md": spisMemory },
  projekt: { "projekt.md": projektCard, "AGENTS.md": projektAgents, "MEMORY.md": projektMemory },
};
