/** @jsxImportSource react */
/**
 * Krok 6 „Pripravené“ (C1): súhrn so stavmi (ikona aj slovo), oprava pri chýbajúcej časti a jedna prvá úloha.
 * Chat s klientom ide cez existujúci `createClientChatFlow` (pripravená správa sa neodošle sama) s náhradnými
 * obrazovkami bez modelu a pri AI hraniciach; usporiadanie podľa tabuľky cez `createReorganizeFlow`.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleHelp, Loader2, MessageSquare, UserRound } from "lucide-react";
import { useLocale } from "@/i18n/use-locale";
import { toggledLeave, triageApply, triageReplan, type TriageClient, type TriagePreview } from "../../roztriedenie/api";
import { friendlyError, useTriageText } from "../../roztriedenie/triage-page";
import type { OnboardingApplyResult } from "../api";
import type { AiModelView } from "../ai-step";
import { clientChatPrompt, type ClientChatOutcome, type ClientChatRequest, type ClientChatUnavailable } from "../client-chat";
import { createClientChatFlow, createReorganizeFlow, type BatchItem } from "../found-flow";
import type { FoundTextKey } from "../found-text";
import { ChatUnavailableView, ReorganizeFailedView, ReorganizeView, runStep } from "../found-screen";
import type { OnboardingCompletion } from "../lawoss-welcome-page";
import type { WizardConnected } from "../onboarding-state";
import type { AgentSummary } from "./agent-mode";
import { ReadyIllustration } from "./illustrations";
import { asBatchItem, readyCompletion, readyPlan, readyRows } from "./ready-model";
import { StatusBadge, StepScreen, type StatusTone } from "./wizard-frame";
import type { WizardText } from "./wizard-text";

type FoundText = (key: FoundTextKey, params?: Record<string, string | number>) => string;

const ICON: Record<StatusTone, ReactNode> = {
  ok: <CircleCheck className="size-3.5" />,
  missing: <CircleAlert className="size-3.5" />,
  warn: <CircleAlert className="size-3.5" />,
  checking: <Loader2 className="size-3.5 animate-spin" />,
  unknown: <CircleHelp className="size-3.5" />,
};

const FIX_TEXT = { folder: "readyFixFolder", ai: "readyFixAi", approvals: "readyFixApprovals" } as const;

const AI_SETTINGS_LANDING = "/settings/ai";
/** Bez klienta roztriedenia sa tabuľka neponúkne; zástupca len splní typ. */
const NO_TRIAGE: TriageClient = { lawossTriage: () => Promise.reject(new Error("triage_unavailable")) };

type Phase =
  | { name: "summary" }
  | { name: "chatUnavailable"; queue: BatchItem[]; reason: ClientChatUnavailable; result?: OnboardingApplyResult }
  | { name: "reorganize"; queue: BatchItem[]; preview: TriagePreview; result?: OnboardingApplyResult }
  | { name: "reorganizeFailed"; queue: BatchItem[]; message: string; result?: OnboardingApplyResult };

export type ReadyStepProps = {
  text: WizardText;
  found: FoundText;
  connected?: WizardConnected;
  model: AiModelView;
  agent: AgentSummary;
  busy: boolean;
  nav?: ReactNode;
  triage: TriageClient | null;
  onRegister: (result?: OnboardingApplyResult, completion?: OnboardingCompletion) => Promise<TriageClient | undefined>;
  onOpenChat?: (request: ClientChatRequest) => Promise<ClientChatOutcome>;
  onFinish: (result?: OnboardingApplyResult, completion?: OnboardingCompletion) => Promise<void>;
  onGo: (target: "folder" | "ai" | "approvals") => void;
  /** Krok práve pracuje (chat, usporiadanie): stránka vypne ukazovateľ priebehu a Späť. */
  onBusy?: (busy: boolean) => void;
  onError: (reason: unknown) => void;
  onClearError: () => void;
};

/** Súhrn a akcie (bez živých tokov); `onChat`/`onTable` chýbajú, keď ich volajúci nevie ponúknuť. */
export function ReadySummaryView({ text, found, connected, model, agent, busy, nav, onGo, onChat, onOverview, onTable }: Pick<ReadyStepProps, "text" | "found" | "connected" | "model" | "agent" | "busy" | "nav" | "onGo"> & {
  onChat?: () => void; onOverview: () => void; onTable?: () => void;
}) {
  const rows = readyRows(text, { connected, model, agent });
  const plan = readyPlan(connected, model);
  const chatName = plan.chatWith?.name ?? "";
  const chat = onChat && plan.chatWith ? (primary: boolean) => (
    <button type="button" className={primary ? "lw-btn gold" : "lw-btn"} disabled={busy} onClick={onChat}>
      <MessageSquare className="size-4" aria-hidden /> {text("readyChat", { name: chatName })}
    </button>
  ) : null;
  return (
    <StepScreen step="ready" title={text("readyTitle")} lead={<p>{text("readyLead")}</p>} art={<ReadyIllustration />} nav={nav}>
      <ul className="lw-wiz-summary" data-lawoss-ready-summary>
        {rows.map((row) => (
          <li key={row.id} data-tone={row.tone}>
            <span className="lw-wiz-summary-label">{text(row.label)}</span>
            <span className="lw-wiz-summary-value">{row.value}</span>
            <StatusBadge text={text} tone={row.tone} icon={ICON[row.tone]} />
            {row.fix ? <button type="button" className="lw-btn" disabled={busy} onClick={() => { if (row.fix) onGo(row.fix); }}>{text(FIX_TEXT[row.fix])}</button> : null}
          </li>
        ))}
      </ul>
      <section className="lw-wiz-first" aria-label={text("readyFirst")} data-lawoss-ready-primary={plan.primary}>
        <h3 className="lw-wiz-label">{text("readyFirst")}</h3>
        {plan.chatWith && connected?.kind === "clients" && connected.clients.length === 1 ? (
          <p className="lw-wiz-client"><UserRound className="size-4 shrink-0" aria-hidden /><span className="min-w-0">{plan.chatWith.name}</span></p>
        ) : null}
        {plan.primary === "chat" && chat ? (
          <>
            <p className="text-sm text-muted-foreground">{text("readyChatHint")}</p>
            <div className="lw-wiz-actions">
              {chat(true)}
              <button type="button" className="lw-btn" disabled={busy} onClick={onOverview}>{text(plan.overview)}</button>
            </div>
          </>
        ) : plan.primary === "connectFolder" ? (
          <div className="lw-wiz-actions">
            <button type="button" className="lw-btn gold" disabled={busy} onClick={() => onGo("folder")}>{text("readyFixFolder")}</button>
            <button type="button" className="lw-btn" disabled={busy} onClick={onOverview}>{text("readyFinish")}</button>
          </div>
        ) : (
          <div className="lw-wiz-actions">
            <button type="button" className="lw-btn gold" disabled={busy} onClick={onOverview}>{text(plan.overview)}</button>
          </div>
        )}
      </section>
      {plan.offerTable && onTable ? (
        <details className="lw-wiz-details">
          <summary>{found("advanced")}</summary>
          <div className="lw-wiz-details-body grid gap-2">
            <p className="text-sm text-muted-foreground">{text("readyTableHint")}</p>
            <div><button type="button" className="lw-btn" disabled={busy} onClick={onTable}>{text("readyTable")}</button></div>
          </div>
        </details>
      ) : null}
    </StepScreen>
  );
}

export function ReadyStep(props: ReadyStepProps) {
  const { text, found, connected, triage, onRegister, onOpenChat, onFinish, onError, onClearError } = props;
  const locale = useLocale();
  const triageText = useTriageText(locale);
  const [phase, setPhase] = useState<Phase>({ name: "summary" });
  const [working, setWorking] = useState(false);
  const busy = props.busy || working;
  const { onBusy } = props;
  useEffect(() => { onBusy?.(working); }, [working]);
  useEffect(() => () => onBusy?.(false), []);
  const triageClient = useRef<TriageClient>(triage ?? NO_TRIAGE);
  const { result, completion } = readyCompletion(connected);
  const clients = connected?.kind === "clients" ? connected.clients.map(asBatchItem) : [];
  const run = (work: () => Promise<void>) => runStep(work, { start: () => { onClearError(); setWorking(true); }, fail: onError, end: () => setWorking(false) });
  const finish = (landing?: string) => run(() => onFinish(result, { ...completion, ...(landing ? { landing } : {}) }));

  const chat = onOpenChat ? createClientChatFlow({
    register: (registered) => onRegister(registered, completion),
    openChat: onOpenChat,
    prompt: (name) => clientChatPrompt(found, name),
    done: (registered, landing) => onFinish(registered, { ...completion, landing }),
    show: setPhase,
  }) : undefined;
  const reorganize = triage ? createReorganizeFlow({
    client: triageClient,
    register: (registered) => onRegister(registered, completion),
    done: (registered) => onFinish(registered, completion),
    show: (view) => setPhase(view.name === "reorganize" ? view : { name: "reorganizeFailed", queue: view.queue, result: view.result, message: friendlyError(view.failure, triageText) }),
  }) : undefined;
  const plan = readyPlan(connected, props.model);
  const chatQueue = plan.chatWith ? [asBatchItem(plan.chatWith), ...clients.filter((item) => item.root !== plan.chatWith?.root)] : clients;

  if (phase.name === "summary") {
    return (
      <ReadySummaryView
        {...props}
        busy={busy}
        onChat={chat ? () => void run(() => chat.begin(chatQueue, plan.chatWith?.result ?? result)) : undefined}
        onOverview={() => void finish()}
        onTable={reorganize && clients.length ? () => void run(() => reorganize.begin(clients, result)) : undefined}
      />
    );
  }
  const [current, ...rest] = phase.queue;
  if (phase.name === "chatUnavailable") {
    return (
      <ChatUnavailableView
        text={found} busy={busy} name={plan.chatWith?.name ?? current?.name ?? ""} reason={phase.reason}
        onSettings={() => void finish(AI_SETTINGS_LANDING)}
        onRetry={() => void run(async () => { if (chat) await chat.begin(phase.queue, phase.result); })}
        onTable={() => void run(async () => { if (reorganize) await reorganize.begin(phase.queue, phase.result); })}
        onFinish={() => void finish()}
      />
    );
  }
  if (phase.name === "reorganizeFailed") {
    return (
      <ReorganizeFailedView
        text={found} busy={busy} name={current?.name ?? ""} message={phase.message} more={rest.length > 0}
        onRetry={() => void run(async () => { if (reorganize) await reorganize.show(phase.queue, phase.result); })}
        onSkip={() => void run(async () => { if (reorganize) await reorganize.show(rest, phase.result); })}
      />
    );
  }
  const client = triage ? triageClient.current : null;
  return (
    <ReorganizeView
      text={found} triageText={triageText} busy={busy} name={current?.name ?? ""} preview={phase.preview} more={rest.length > 0}
      onKeep={(id, keep) => void run(async () => {
        if (!client) return;
        const keepInInbox = keep ? [...phase.preview.keepInInbox, id] : phase.preview.keepInInbox.filter((item) => item !== id);
        setPhase({ ...phase, preview: await triageReplan(client, phase.preview.id, keepInInbox) });
      })}
      onLeave={(key, leave) => void run(async () => {
        if (!client) return;
        setPhase({ ...phase, preview: await triageReplan(client, phase.preview.id, phase.preview.keepInInbox, toggledLeave(phase.preview, key, leave)) });
      })}
      onConfirm={() => void run(async () => { if (client && reorganize) { await triageApply(client, phase.preview); await reorganize.show(rest, phase.result); } })}
      onSkip={() => void run(async () => { if (reorganize) await reorganize.show(rest, phase.result); })}
    />
  );
}
