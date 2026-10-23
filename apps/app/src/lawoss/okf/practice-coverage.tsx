import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { clientLabel, folderName, prettyFolderName } from "../lite/client-row";
import { clientRowFrom } from "../lite/client-row-view";
import { useClientNav } from "../lite/client-nav";
import type { ClientRowFacts } from "../lite/client-row-data";
import type { OkfReadResult, OkfScope, OkfSourceReadState } from "./read-model";

const SOURCE_LABELS: Record<OkfSourceReadState["state"], string> = {
  fresh: "lawoss.practice.fresh", stale: "lawoss.practice.stale", unavailable: "lawoss.practice.unavailable", truncated: "lawoss.practice.truncated",
};

type Rows = ReadonlyMap<string, ClientRowFacts> | undefined;

/**
 * Meno zdroja pre advokáta (P6, N-A2-8): rovnaké ako v bočnom paneli (riadok klienta z `client.md`), mimo panela
 * názov z karty klienta v prečítaných dátach, nikdy holý slug priečinka.
 */
export function practiceSourceName(source: OkfSourceReadState, scope: OkfScope | null, data: OkfReadResult, rows: Rows, locale: Language): string {
  if (!source.workspaceId) return t("lawoss.practice.office", locale);
  const member = scope?.members.find((m) => m.workspace.id === source.workspaceId);
  const nativeLabel = member?.workspace.displayNameResolved ?? member?.workspace.name ?? source.workspaceId;
  const facts = rows?.get(source.workspaceId);
  if (facts) return clientRowFrom(facts, nativeLabel, locale).label;
  const card = data.clients?.find((client) => client.path === (member?.prefix ?? ""))?.title;
  return clientLabel({ nativeLabel, path: member?.workspace.path ?? null, eligible: Boolean(member), cardTitle: card }).label;
}

const sourceState = (source: OkfSourceReadState, failed: boolean | undefined): OkfSourceReadState["state"] =>
  failed && source.state === "fresh" ? "stale" : source.state;

function formatTime(at: number, locale: Language, now: number): string {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat(locale, sameDay ? { timeStyle: "short" } : { dateStyle: "short", timeStyle: "short" }).format(at);
}

/**
 * Stav čítania praxe (P6, N-A2-8): jeden riadok (prax, počet klientov, kedy sa naposledy prečítala), zoznam len tých
 * zdrojov, ktoré sa nepodarilo prečítať, a podrobnosti pod rozbaľovačom. Neúspešný zdroj nie je prázdny: neúplné
 * čítanie ostáva výstrahou s časom posledného úspešného čítania; čas patrí snímke zdroja, nie zlyhanému obnoveniu.
 */
export function PracticeCoverage({ data, scope, failed, excludedWorkspaceIds = [], now = Date.now() }: {
  data: OkfReadResult; scope: OkfScope | null; failed?: boolean; excludedWorkspaceIds?: readonly string[]; now?: number;
}) {
  const locale = useLocale();
  const rows = useClientNav()?.rows;
  const coverage = data.coverage;
  if (!coverage) return null;
  const incomplete = failed || coverage.status !== "complete";
  const clients = coverage.sources.filter((source) => source.workspaceId).length;
  const successes = coverage.sources.map((source) => source.lastSuccessAt);
  const oldest = successes.every((at): at is number => at !== null) && successes.length ? Math.min(...successes) : null;
  const problems = coverage.sources.filter((source) => sourceState(source, failed) !== "fresh");
  const name = (source: OkfSourceReadState) => practiceSourceName(source, scope, data, rows, locale);
  const line = (source: OkfSourceReadState) => `${name(source)}: ${t(SOURCE_LABELS[sourceState(source, failed)], locale)}${source.lastSuccessAt !== null ? ` · ${formatTime(source.lastSuccessAt, locale, now)}` : ""}`;
  const summary = [
    scope?.practiceRoot ? `${t("lawoss.practice.selected", locale)}: ${prettyFolderName(folderName(scope.practiceRoot))}` : t("lawoss.practice.single", locale),
    ...(scope?.practiceRoot ? [t("lawoss.practice.clients", { lng: locale, count: clients })] : []),
    oldest !== null ? t("lawoss.practice.updated", locale, { time: formatTime(oldest, locale, now) }) : null,
    excludedWorkspaceIds.length ? t("lawoss.practice.excluded", locale, { count: excludedWorkspaceIds.length }) : null,
  ].filter(Boolean).join(" · ");
  return <div className={incomplete ? "lw-status warn" : "lw-status"} role={incomplete ? "alert" : "status"} data-lawoss-practice-coverage={failed ? "partial" : coverage.status}>
    <p>{summary}</p>
    {incomplete ? <p>{t("lawoss.practice.incomplete", locale)}</p> : null}
    {problems.length ? <ul data-lawoss-practice-problems="">{problems.map((source) => <li key={JSON.stringify([source.source, source.workspaceId])}>{line(source)}</li>)}</ul> : null}
    <details data-lawoss-practice-details="">
      <summary>{t("lawoss.practice.details", locale)}</summary>
      {scope?.practiceRoot ? <p>{t("lawoss.practice.folder", locale, { path: scope.practiceRoot })}</p> : null}
      <ul>{coverage.sources.map((source) => <li key={JSON.stringify([source.source, source.workspaceId])}>{line(source)}</li>)}</ul>
    </details>
  </div>;
}
