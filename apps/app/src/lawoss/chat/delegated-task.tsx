import { useMemo } from "react";
import { t } from "@/i18n";
import { useMessageList } from "@/components/chat/message-list-provider";
import { useQueryCacheState } from "@/react-app/infra/query-cache-state";
import { emptyInteractionSessions, interactionSessionsKey } from "@/react-app/domains/session/sync/interaction-state";

export function DelegatedTask({ text }: { text: string }) {
  const { sessionId, workspaceId } = useMessageList();
  const key = useMemo(() => interactionSessionsKey(workspaceId), [workspaceId]);
  const session = useQueryCacheState(key, emptyInteractionSessions)[sessionId];
  if (!session?.parentID) return <>{text}</>;
  return <div className="space-y-1.5">
    <div className="text-xs text-muted-foreground">{t("lawoss.matters.delegated")}</div>
    {session.title && <strong className="font-medium">{session.title}</strong>}
    <details className="text-sm text-muted-foreground">
      <summary className="cursor-pointer">{t("lawoss.matters.taskDetail")}</summary>
      <p className="mt-2 whitespace-pre-wrap break-words">{text.slice(text.indexOf("\n") + 1)}</p>
    </details>
  </div>;
}
