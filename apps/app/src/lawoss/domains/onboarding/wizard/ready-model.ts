/**
 * Súhrn a prvá úloha kroku „Pripravené“ (C1) bez Reactu: čo je pripojené, čo funguje, čo chýba a jedna
 * prvá úloha so splnenými predpokladmi (chat len s pripraveným modelom a pridaným klientom, inak prehľad).
 */
import type { OnboardingApplyResult } from "../api";
import type { BatchItem } from "../found-flow";
import { firstWorkspaceResult, workspaceResults } from "../found-flow";
import { FRESH_OFFICE_COMPLETION } from "../found-flow";
import type { OnboardingCompletion } from "../lawoss-welcome-page";
import type { ConnectedClient, WizardConnected } from "../onboarding-state";
import type { AiModelView } from "../ai-step";
import type { AgentSummary } from "./agent-mode";
import type { StatusTone } from "./wizard-frame";
import type { WizardText, WizardTextKey } from "./wizard-text";

export type ReadyRow = { id: "docs" | "ai" | "approvals"; label: WizardTextKey; tone: StatusTone; value: string; fix?: "folder" | "ai" | "approvals" };

function docsRow(text: WizardText, connected: WizardConnected | undefined): ReadyRow {
  const row = { id: "docs", label: "readyDocs" } as const;
  if (!connected) return { ...row, tone: "missing", value: text("readyNoFolder"), fix: "folder" };
  if (connected.kind === "fresh") return { ...row, tone: "ok", value: text("readyFresh") };
  if (connected.kind === "practice") return { ...row, tone: "ok", value: text("readyPractice") };
  const [first] = connected.clients;
  if (!first) return { ...row, tone: "missing", value: text("readyNoFolder"), fix: "folder" };
  return { ...row, tone: "ok", value: connected.clients.length === 1 ? text("readyClient", { name: first.name }) : text("readyClients", { count: connected.clients.length }) };
}

function aiRow(text: WizardText, model: AiModelView): ReadyRow {
  const row = { id: "ai", label: "readyAi" } as const;
  if (model.state === "ready") return { ...row, tone: "ok", value: model.modelLabel ?? text("aiStateReady") };
  if (model.state === "checking") return { ...row, tone: "checking", value: text("aiStateChecking") };
  return { ...row, tone: model.state === "no-model" || model.state === "no-workspace" ? "missing" : "warn", value: text("readyNoAi"), fix: "ai" };
}

const AGENT_TEXT: Record<AgentSummary, WizardTextKey> = { ask: "readyAsk", yolo: "readyYolo", allow: "permAllow", unknown: "readyUnknown" };

function approvalsRow(text: WizardText, agent: AgentSummary): ReadyRow {
  const row = { id: "approvals", label: "readyApprovals", value: text(AGENT_TEXT[agent]) } as const;
  // Neznámy stav nie je „overujem“ (nikdy by neskončil); YOLO aj zmeny bez pýtania sa dajú zmeniť v kroku 5.
  if (agent === "ask") return { ...row, tone: "ok" };
  if (agent === "unknown") return { ...row, tone: "unknown" };
  return { ...row, tone: "warn", fix: "approvals" };
}

export function readyRows(text: WizardText, input: { connected?: WizardConnected; model: AiModelView; agent: AgentSummary }): ReadyRow[] {
  return [docsRow(text, input.connected), aiRow(text, input.model), approvalsRow(text, input.agent)];
}

/** Pripojený klient ako položka dávky pre existujúce toky chatu a usporiadania. */
export const asBatchItem = (client: ConnectedClient): BatchItem => ({ root: client.root, name: client.name, status: "done", result: client.result });

export type ReadyPlan = {
  /** Jedna hlavná akcia. */
  primary: "chat" | "overview" | "addClient" | "connectFolder";
  /** Text tlačidla prehľadu (hlavného alebo vedľajšieho). */
  overview: WizardTextKey;
  /** Klient pre chat (prvý s pracovným priečinkom). */
  chatWith?: ConnectedClient;
  /** „Usporiadať podľa tabuľky“ v Pokročilé. */
  offerTable: boolean;
};

/**
 * Prvá úloha: s pripraveným modelom chat s (prvým) klientom (pripravená správa, neodošle sa sama), prehľad
 * klienta či klientov vedľa; bez modelu prehľad. Celá prax ako jeden priečinok nemá klienta, preto prehľad praxe;
 * nová kancelária pridá prvého klienta; bez priečinka návrat na Dokumenty.
 */
export function readyPlan(connected: WizardConnected | undefined, model: AiModelView): ReadyPlan {
  const none = { offerTable: false } as const;
  if (!connected) return { ...none, primary: "connectFolder", overview: "readyFinish" };
  if (connected.kind === "fresh") return { ...none, primary: "addClient", overview: "readyAddClient" };
  if (connected.kind === "practice") return { ...none, primary: "overview", overview: "readyOverviewPractice" };
  const chatWith = connected.clients.find((client) => client.result.workspace) ?? connected.clients[0];
  if (!chatWith) return { ...none, primary: "connectFolder", overview: "readyFinish" };
  // Prax s viacerými klientmi ponúkne chat s prvým pridaným klientom ako hlavnú akciu (#197, N-A2-4); prehľad je vedľa.
  const primary = model.state === "ready" ? "chat" : "overview";
  return { primary, overview: connected.clients.length === 1 ? "readyOverview" : "readyOverviewClients", chatWith, offerTable: true };
}

/** Výsledok a doplnenie dokončenia: kam appka pristane a koho zaregistruje. */
export function readyCompletion(connected: WizardConnected | undefined): { result?: OnboardingApplyResult; completion?: OnboardingCompletion } {
  if (!connected) return {};
  if (connected.kind === "fresh") return { result: connected.result, completion: FRESH_OFFICE_COMPLETION };
  if (connected.kind === "practice") return { completion: { workingFolder: connected.root } };
  const items = connected.clients.map(asBatchItem);
  return { result: firstWorkspaceResult(items) ?? connected.clients[0]?.result, completion: { clients: workspaceResults(items) } };
}
