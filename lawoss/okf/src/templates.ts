import communicationRegister from "../templates/spis/KOMUNIKACNE-KANALY.md" with { type: "text" };
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

import spisInputs from "../templates/spis/VSTUPY.md" with { type: "text" };

import type { TemplateSet, LocalizedTemplateSet } from "./core.ts";

export const TEMPLATES: TemplateSet = {
  klient: { "KOMUNIKACNE-KANALY.md": communicationRegister, "VSTUPY.md": spisInputs, "client.md": klientCard, "AGENTS.md": klientAgents, "MEMORY.md": klientMemory },
  spis: { "KOMUNIKACNE-KANALY.md": communicationRegister, "VSTUPY.md": spisInputs, "matter.md": spisCard, "_STATUS.md": spisStatus, "AGENTS.md": spisAgents, "MEMORY.md": spisMemory },
  projekt: { "project.md": projektCard, "AGENTS.md": projektAgents, "MEMORY.md": projektMemory },
};

import communicationRegisterCS from "../templates/cs/spis/KOMUNIKACNE-KANALY.md" with { type: "text" };
import klientAgentsCS from "../templates/cs/klient/AGENTS.md" with { type: "text" };
import klientMemoryCS from "../templates/cs/klient/MEMORY.md" with { type: "text" };
import klientCardCS from "../templates/cs/klient/klient.md" with { type: "text" };
import spisAgentsCS from "../templates/cs/spis/AGENTS.md" with { type: "text" };
import spisMemoryCS from "../templates/cs/spis/MEMORY.md" with { type: "text" };
import spisStatusCS from "../templates/cs/spis/_STATUS.md" with { type: "text" };
import spisCardCS from "../templates/cs/spis/spis.md" with { type: "text" };
import projektAgentsCS from "../templates/cs/projekt/AGENTS.md" with { type: "text" };
import projektMemoryCS from "../templates/cs/projekt/MEMORY.md" with { type: "text" };
import projektCardCS from "../templates/cs/projekt/projekt.md" with { type: "text" };
import spisInputsCS from "../templates/cs/spis/VSTUPY.md" with { type: "text" };

const CS_TEMPLATES: TemplateSet = {
  klient: { "KOMUNIKACNE-KANALY.md": communicationRegisterCS, "VSTUPY.md": spisInputsCS, "client.md": klientCardCS, "AGENTS.md": klientAgentsCS, "MEMORY.md": klientMemoryCS },
  spis: { "KOMUNIKACNE-KANALY.md": communicationRegisterCS, "VSTUPY.md": spisInputsCS, "matter.md": spisCardCS, "_STATUS.md": spisStatusCS, "AGENTS.md": spisAgentsCS, "MEMORY.md": spisMemoryCS },
  projekt: { "project.md": projektCardCS, "AGENTS.md": projektAgentsCS, "MEMORY.md": projektMemoryCS },
};

import communicationRegisterEN from "../templates/en/spis/KOMUNIKACNE-KANALY.md" with { type: "text" };
import klientAgentsEN from "../templates/en/klient/AGENTS.md" with { type: "text" };
import klientMemoryEN from "../templates/en/klient/MEMORY.md" with { type: "text" };
import klientCardEN from "../templates/en/klient/klient.md" with { type: "text" };
import spisAgentsEN from "../templates/en/spis/AGENTS.md" with { type: "text" };
import spisMemoryEN from "../templates/en/spis/MEMORY.md" with { type: "text" };
import spisStatusEN from "../templates/en/spis/_STATUS.md" with { type: "text" };
import spisCardEN from "../templates/en/spis/spis.md" with { type: "text" };
import projektAgentsEN from "../templates/en/projekt/AGENTS.md" with { type: "text" };
import projektMemoryEN from "../templates/en/projekt/MEMORY.md" with { type: "text" };
import projektCardEN from "../templates/en/projekt/projekt.md" with { type: "text" };
import spisInputsEN from "../templates/en/spis/VSTUPY.md" with { type: "text" };

const EN_TEMPLATES: TemplateSet = {
  klient: { "KOMUNIKACNE-KANALY.md": communicationRegisterEN, "VSTUPY.md": spisInputsEN, "client.md": klientCardEN, "AGENTS.md": klientAgentsEN, "MEMORY.md": klientMemoryEN },
  spis: { "KOMUNIKACNE-KANALY.md": communicationRegisterEN, "VSTUPY.md": spisInputsEN, "matter.md": spisCardEN, "_STATUS.md": spisStatusEN, "AGENTS.md": spisAgentsEN, "MEMORY.md": spisMemoryEN },
  projekt: { "project.md": projektCardEN, "AGENTS.md": projektAgentsEN, "MEMORY.md": projektMemoryEN },
};

export const LOCALIZED_TEMPLATES: LocalizedTemplateSet = { cs: CS_TEMPLATES, sk: TEMPLATES, en: EN_TEMPLATES };
