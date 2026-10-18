import { useMarkdownStreams } from "./markdown-stream";
import type { OpenTarget } from "./open-target";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export function MarkdownStreamLinks({ workspaceId, sessionId, onOpen }: { workspaceId: string; sessionId: string; onOpen?: (target: OpenTarget) => void }) {
  const items = useMarkdownStreams(state => state.items);
  const streams = Object.values(items).filter(item => item.workspaceId === workspaceId && item.sessionId === sessionId && item.status !== "writing");
  if (!streams.length) return null;
  return <div className="flex flex-wrap gap-2 px-4 py-2">{streams.map(stream => <Button key={stream.id} variant="outline" size="sm" onClick={() => onOpen?.({
    id: `file:${stream.path}`, kind: "file", value: stream.path, name: stream.path.split("/").at(-1)!, preview: "markdown", confidence: 1, reason: "streaming-markdown", streaming: true,
  })}>{stream.status === "writing" ? t("markdown.agent_writing") : stream.status === "failed" ? t("markdown.generation_stopped") : t("common.saved")}: {stream.path}</Button>)}</div>;
}
