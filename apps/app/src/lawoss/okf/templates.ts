import communicationRegisterCS from "../../../../../lawoss/okf/templates/cs/spis/KOMUNIKACNE-KANALY.md?raw";
import klientAgentsCS from "../../../../../lawoss/okf/templates/cs/klient/AGENTS.md?raw";
import klientMemoryCS from "../../../../../lawoss/okf/templates/cs/klient/MEMORY.md?raw";
import klientCardCS from "../../../../../lawoss/okf/templates/cs/klient/klient.md?raw";
import spisAgentsCS from "../../../../../lawoss/okf/templates/cs/spis/AGENTS.md?raw";
import spisMemoryCS from "../../../../../lawoss/okf/templates/cs/spis/MEMORY.md?raw";
import spisStatusCS from "../../../../../lawoss/okf/templates/cs/spis/_STATUS.md?raw";
import spisCardCS from "../../../../../lawoss/okf/templates/cs/spis/spis.md?raw";
import projektAgentsCS from "../../../../../lawoss/okf/templates/cs/projekt/AGENTS.md?raw";
import projektMemoryCS from "../../../../../lawoss/okf/templates/cs/projekt/MEMORY.md?raw";
import projektCardCS from "../../../../../lawoss/okf/templates/cs/projekt/projekt.md?raw";
import spisInputsCS from "../../../../../lawoss/okf/templates/cs/spis/VSTUPY.md?raw";
import communicationRegisterEN from "../../../../../lawoss/okf/templates/en/spis/KOMUNIKACNE-KANALY.md?raw";
import klientAgentsEN from "../../../../../lawoss/okf/templates/en/klient/AGENTS.md?raw";
import klientMemoryEN from "../../../../../lawoss/okf/templates/en/klient/MEMORY.md?raw";
import klientCardEN from "../../../../../lawoss/okf/templates/en/klient/klient.md?raw";
import spisAgentsEN from "../../../../../lawoss/okf/templates/en/spis/AGENTS.md?raw";
import spisMemoryEN from "../../../../../lawoss/okf/templates/en/spis/MEMORY.md?raw";
import spisStatusEN from "../../../../../lawoss/okf/templates/en/spis/_STATUS.md?raw";
import spisCardEN from "../../../../../lawoss/okf/templates/en/spis/spis.md?raw";
import projektAgentsEN from "../../../../../lawoss/okf/templates/en/projekt/AGENTS.md?raw";
import projektMemoryEN from "../../../../../lawoss/okf/templates/en/projekt/MEMORY.md?raw";
import projektCardEN from "../../../../../lawoss/okf/templates/en/projekt/projekt.md?raw";
import spisInputsEN from "../../../../../lawoss/okf/templates/en/spis/VSTUPY.md?raw";
import communicationRegister from "../../../../../lawoss/okf/templates/spis/KOMUNIKACNE-KANALY.md?raw";
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

import spisInputs from "../../../../../lawoss/okf/templates/spis/VSTUPY.md?raw";

import type { LocalizedTemplateSet, TemplateSet } from "../../../../../lawoss/okf/src/core";

const OKF_TEMPLATES: TemplateSet = {
  klient: { "KOMUNIKACNE-KANALY.md": communicationRegister, "VSTUPY.md": spisInputs, "client.md": klientCard, "AGENTS.md": klientAgents, "MEMORY.md": klientMemory },
  spis: { "KOMUNIKACNE-KANALY.md": communicationRegister, "VSTUPY.md": spisInputs, "matter.md": spisCard, "_STATUS.md": spisStatus, "AGENTS.md": spisAgents, "MEMORY.md": spisMemory },
  projekt: { "project.md": projektCard, "AGENTS.md": projektAgents, "MEMORY.md": projektMemory },
};

/** All preview languages use the exact templates shipped with the CLI. */
export const LOCALIZED_OKF_TEMPLATES: LocalizedTemplateSet = {
  sk: OKF_TEMPLATES,
  cs: {
    klient: { "KOMUNIKACNE-KANALY.md": communicationRegisterCS, "VSTUPY.md": spisInputsCS, "client.md": klientCardCS, "AGENTS.md": klientAgentsCS, "MEMORY.md": klientMemoryCS },
    spis: { "KOMUNIKACNE-KANALY.md": communicationRegisterCS, "VSTUPY.md": spisInputsCS, "matter.md": spisCardCS, "_STATUS.md": spisStatusCS, "AGENTS.md": spisAgentsCS, "MEMORY.md": spisMemoryCS },
    projekt: { "project.md": projektCardCS, "AGENTS.md": projektAgentsCS, "MEMORY.md": projektMemoryCS },
  },
  en: {
    klient: { "KOMUNIKACNE-KANALY.md": communicationRegisterEN, "VSTUPY.md": spisInputsEN, "client.md": klientCardEN, "AGENTS.md": klientAgentsEN, "MEMORY.md": klientMemoryEN },
    spis: { "KOMUNIKACNE-KANALY.md": communicationRegisterEN, "VSTUPY.md": spisInputsEN, "matter.md": spisCardEN, "_STATUS.md": spisStatusEN, "AGENTS.md": spisAgentsEN, "MEMORY.md": spisMemoryEN },
    projekt: { "project.md": projektCardEN, "AGENTS.md": projektAgentsEN, "MEMORY.md": projektMemoryEN },
  },
};
