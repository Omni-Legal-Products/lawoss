/**
 * Skutočné otvorenie chatu s klientom po pridaní priečinka (welcome-route ho odovzdá obrazovke „Toto som
 * našiel“). Skladá existujúce časti: spojenie OKF, AI hranice zo servera, zoznam poskytovateľov z enginu
 * priečinka klienta, balík skillov OKF s overením /novy-spis (ako Roztriedenie pred /roztried-spis)
 * a `openSessionWithPrompt`, ktorý správu len pripraví do poľa správy, nič neodosiela.
 */
import type { Language } from "@/i18n";
import type { ModelRef } from "@/app/types";
import { createClient } from "@/app/lib/opencode";
import { toSessionTransportDirectory } from "@/app/lib/session-scope";
import { resolveWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { normalizeDirectoryPath } from "@/app/utils";
import { fetchProviderList } from "@/react-app/infra/provider-list-query";
import { loadOkfConnection, openSessionWithPrompt, type OkfConnection } from "../../okf/connection";
import { ensureSkillAvailable, workspaceSkillEngine } from "../../okf/skill-availability";
import { publishAiBoundaries } from "../ai/boundaries-store";
import { installMissingOnboardingSkills } from "./install-pack";
import { clientChatMessage, prepareClientChat, type ClientChatOutcome, type ClientChatRequest } from "./client-chat";

/**
 * Priečinok klienta pre chat: podľa id z výsledku registrácie, inak podľa cesty. Len lokálny pracovný
 * priečinok so spojením na server a tokenom enginu; inak `null` a chat sa neotvorí.
 */
export function clientChatTarget(connection: OkfConnection, request: Pick<ClientChatRequest, "workspaceId" | "directory">) {
  const client = connection.client;
  const directory = normalizeDirectoryPath(request.directory);
  const workspace = connection.workspaces.find(item => item.id === request.workspaceId) ?? connection.workspaces.find(item => normalizeDirectoryPath(item.path) === directory);
  if (!client || !workspace || workspace.workspaceType === "remote") return null;
  const endpoint = resolveWorkspaceEndpoint(workspace, { baseUrl: connection.baseUrl, token: connection.token });
  return endpoint?.token ? { client, workspace, endpoint } : null;
}

export async function openOnboardedClientChat(request: ClientChatRequest, options: { skillLanguage: Language; defaultModel: ModelRef | null | undefined }, load: () => Promise<OkfConnection> = loadOkfConnection): Promise<ClientChatOutcome> {
  const connection = await load();
  const target = clientChatTarget(connection, request);
  if (!target) return { unavailable: "failed" };
  const { client, workspace, endpoint } = target;
  const opencode = createClient(endpoint.opencodeBaseUrl, toSessionTransportDirectory(workspace.path) || undefined, { token: endpoint.token, mode: "legalwork" });
  return prepareClientChat({
    governance: async () => {
      const view = await client.aiGovernance();
      publishAiBoundaries(view.boundaries);
      return view.boundaries;
    },
    providerList: () => fetchProviderList({ client: opencode, baseUrl: endpoint.opencodeBaseUrl, directory: workspace.path }),
    defaultModel: options.defaultModel,
    installSkills: () => installMissingOnboardingSkills(client, workspace.id, options.skillLanguage),
    skillAvailability: async (name) => {
      const engine = workspaceSkillEngine(connection, workspace);
      return engine ? ensureSkillAvailable(engine, name) : "missing";
    },
    // Priečinok klienta je pracovný priečinok; jeho registrovaná cesta je tá, ktorú server overuje.
    // Technické pokyny idú skryto s prvou správou (N-A4-1), advokát vidí len vetu.
    open: (skill) => {
      const message = clientChatMessage(request.prompt, skill);
      return openSessionWithPrompt(connection, workspace, message.text, toSessionTransportDirectory(workspace.path), message.modelContext);
    },
  });
}
