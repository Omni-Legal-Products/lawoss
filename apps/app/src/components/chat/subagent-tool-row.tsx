import { useMemo } from "react";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useQueryCacheState } from "@/react-app/infra/query-cache-state";
import { emptyInteractionSessions, interactionSessionsKey, type InteractionSessions } from "@/react-app/domains/session/sync/interaction-state";
import { useSessionActivityStore, type SessionActivityStatus } from "@/react-app/domains/session/status/session-activity-store";
import { useMessageList } from "./message-list-provider";
import { subagentDescription, subagentSessionId, subagentStatus } from "./subagent-tool";
import { SubagentDot, subagentColors } from "./subagent-dot";

type ToolPart = ToolUIPart | DynamicToolUIPart;

export function SubagentToolRows({ parts }: { parts: ToolPart[] }) {
  return <section className="flex w-full min-w-0 flex-col items-start gap-1" aria-label={t("session.subagents")}>
    {parts.map(part => <LiveSubagentRow key={part.toolCallId} part={part} />)}
  </section>;
}

function LiveSubagentRow({ part }: { part: ToolPart }) {
  const { workspaceId, sessionId: parentSessionId, onOpenSession, pendingInteractionSessionIds } = useMessageList();
  const key = useMemo(() => interactionSessionsKey(workspaceId), [workspaceId]);
  const sessions = useQueryCacheState<InteractionSessions>(key, emptyInteractionSessions);
  const colors = useMemo(() => subagentColors(parentSessionId, sessions), [parentSessionId, sessions]);
  const sessionId = subagentSessionId(part);
  const activity = useSessionActivityStore(state => sessionId ? state.statusesByWorkspaceId[workspaceId]?.[sessionId] : undefined);
  const status = subagentStatus(part, activity, Boolean(sessionId && pendingInteractionSessionIds.includes(sessionId)));
  const title = subagentDescription(part) || (sessionId && sessions[sessionId]?.title) || t("session.subagent");
  return <SubagentRow title={title} status={status} color={sessionId ? colors.get(sessionId) : undefined}
    onOpen={sessionId && onOpenSession ? () => onOpenSession(sessionId) : undefined} />;
}

export function SubagentRow({ title, status, color, onOpen }: {
  title: string; status: SessionActivityStatus; color?: string; onOpen?: () => void;
}) {
  return <Button variant="ghost" size="sm" disabled={!onOpen} onClick={onOpen} title={title}
    aria-label={`${t("session.open_subagent_chat")}: ${title}`}
    className="h-7 max-w-full min-w-0 justify-start gap-2 rounded-md px-2 text-left text-sm font-normal disabled:opacity-100">
    <SubagentDot color={color} status={status} />
    <span className="min-w-0 truncate">{t("session.subagent_started", { name: title })}</span>
  </Button>;
}
