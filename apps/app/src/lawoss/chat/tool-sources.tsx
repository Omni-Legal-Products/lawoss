import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { BookOpen, CircleAlert } from "lucide-react";
import { t } from "@/i18n";
import { getCodeModeToolNames } from "@/lib/tool-activity";
import { marketplaceToolConnector } from "../domains/marketplace/mcp-servers";

type Tool = DynamicToolUIPart | ToolUIPart;

/** Summarize only actual runtime receipts. An agent can mention any tool in its prompt. */
export function ToolSources({ tools }: { tools: readonly Tool[] }) {
  const used = new Map<string, string>();
  const failed = new Map<string, string>();
  const add = (list: Map<string, string>, name: string) => {
    const source = marketplaceToolConnector(name);
    if (source) list.set(source.server, source.title);
  };
  for (const tool of tools) {
    const name = tool.type === "dynamic-tool" ? tool.toolName : tool.type.slice(5);
    if (name === "execute") {
      for (const inner of getCodeModeToolNames(tool, true)) add(used, inner);
      const errors = tool.callProviderMetadata?.opencode?.failedTools;
      if (Array.isArray(errors)) for (const inner of errors) if (typeof inner === "string") add(failed, inner);
    } else if (tool.state === "output-available") add(used, name);
    else if (tool.state === "output-error") add(failed, name);
  }
  if (!used.size && !failed.size) return null;
  return <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1 pl-6 text-xs text-muted-foreground">
    {used.size > 0 && <span className="inline-flex items-center gap-1.5" title={t("lawoss.matters.usedSources")}>
      <BookOpen aria-hidden className="size-3.5" /><span className="sr-only">{t("lawoss.matters.usedSources")} </span>{[...used.values()].join(" · ")}
    </span>}
    {failed.size > 0 && <span className="inline-flex items-center gap-1.5" title={t("lawoss.matters.failedSource")}>
      <CircleAlert aria-hidden className="size-3.5 text-amber-500" />{t("lawoss.matters.failedSource")} · {[...failed.values()].join(" · ")}
    </span>}
  </div>;
}
