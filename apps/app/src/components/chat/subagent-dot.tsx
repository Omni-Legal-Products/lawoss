import { Check, CircleAlert, Clock3, X } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { getSessionActivityStatusLabel, type SessionActivityStatus } from "@/react-app/domains/session/status/session-activity-store";
import { interactionSessionIds, type InteractionSessions } from "@/react-app/domains/session/sync/interaction-state";

const palette = ["text-blue-8", "text-violet-8", "text-teal-8", "text-orange-8", "text-pink-8", "text-cyan-8"];

export function subagentColors(sessionId: string, sessions: InteractionSessions) {
  let rootId = sessionId;
  const visited = new Set([rootId]);
  while (true) {
    const parentId = sessions[rootId]?.parentID;
    if (!parentId || visited.has(parentId)) break;
    visited.add(parentId);
    rootId = parentId;
  }
  const ids = interactionSessionIds(rootId, sessions).filter(id => id !== rootId).sort();
  return new Map(ids.map((id, index) => [id, palette[index % palette.length]]));
}

export function SubagentDot({ color = palette[0], status, stopped = false, compact = false }: {
  color?: string; status: SessionActivityStatus; stopped?: boolean; compact?: boolean;
}) {
  const working = status === "thinking" || status === "responding" || status === "compacting";
  const Icon = stopped ? X : status === "idle" ? Check : status === "error" ? CircleAlert : status === "waiting" ? Clock3 : null;
  const label = stopped ? t("session.subagent_stopped") : status === "idle" ? t("session.subagent_completed") : getSessionActivityStatusLabel(status);
  return <span role="img" aria-label={label} className={cn("relative flex shrink-0 items-center justify-center", compact ? "size-2" : "size-2.5", color, status === "idle" && "opacity-50")}>
    <span aria-hidden className="absolute inset-0 rounded-full bg-current" />
    {working && <span aria-hidden className="absolute -inset-0.5 rounded-full border border-current border-t-transparent motion-safe:animate-spin" />}
    {Icon && !compact && <Icon aria-hidden className="relative size-2 text-white" strokeWidth={2.5} />}
  </span>;
}
