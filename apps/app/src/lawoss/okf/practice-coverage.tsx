import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import type { OkfReadResult, OkfScope, OkfSourceReadState } from "./read-model";

const SOURCE_LABELS: Record<OkfSourceReadState["state"], string> = {
  fresh: "lawoss.practice.fresh", stale: "lawoss.practice.stale", unavailable: "lawoss.practice.unavailable", truncated: "lawoss.practice.truncated",
};

/** Shared host coverage; timestamps belong to source snapshots, never to failed refreshes. */
export function PracticeCoverage({ data, scope, failed, excludedWorkspaceIds = [] }: {
  data: OkfReadResult; scope: OkfScope | null; failed?: boolean; excludedWorkspaceIds?: readonly string[];
}) {
  const locale = useLocale();
  const coverage = data.coverage;
  if (!coverage) return null;
  const incomplete = failed || coverage.status !== "complete";
  return <div className={incomplete ? "lw-status warn" : "lw-status"} role={incomplete ? "alert" : "status"} data-lawoss-practice-coverage={failed ? "partial" : coverage.status}>
    <p>{scope?.practiceRoot ? `${t("lawoss.practice.selected", locale)}: ${scope.practiceRoot}` : t("lawoss.practice.single", locale)} · {t("lawoss.practice.excluded", locale, { count: excludedWorkspaceIds.length })}</p>
    {incomplete ? <p>{t("lawoss.practice.incomplete", locale)}</p> : null}
    <ul>{coverage.sources.map(source => <li key={JSON.stringify([source.source, source.workspaceId])}>
      {source.workspaceId ? scope?.members.find(m => m.workspace.id === source.workspaceId)?.workspace.displayNameResolved ?? source.workspaceId : t("lawoss.practice.office", locale)}: {t(SOURCE_LABELS[failed && source.state === "fresh" ? "stale" : source.state], locale)}
      {source.lastSuccessAt !== null ? ` · ${new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }).format(source.lastSuccessAt)}` : ""}
    </li>)}</ul>
  </div>;
}
