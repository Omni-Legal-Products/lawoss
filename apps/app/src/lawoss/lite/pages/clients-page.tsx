/** @jsxImportSource react */
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, FolderOpen } from "lucide-react";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { OkfPage, type OkfPageMeta } from "../../domains/okf-page";
import { litePageProps } from "../state-text";
import { formatDay, today, useOkfConnection, type OkfReadResult, type OkfScope } from "../../okf/read-model";
import { isOfficeFile } from "../../../../../../lawoss/okf/read";
import { urgencyOf } from "../../okf/view-rules";
import { groupByClient, nextDeadline, type ClientGroup } from "../today-model";
import { ATTACH_EXISTING_CLIENT_PATH, liteMatterLink } from "../links";
import { clientRootOf, practiceClientChoices, type ClientChoice } from "../client-choice";
import { NewMatterAction } from "../client-picker";
import { TriageEntry } from "../../domains/roztriedenie/triage-entry";
import { hotDeadlineCount, LiveStamp, matterUrgency, useHotTitle, useMinuteTick } from "../live";
import "./okf-glass.css";
import "./clients.css";

export function ClientsPage() {
  const locale = useLocale();
  return <OkfPage {...litePageProps(locale)} hasContent={(data) => data.matters.length > 0 || (data.clients?.length ?? 0) > 0}>{(data, meta, scope) => <ClientsLive data={data} meta={meta} scope={scope} locale={locale} />}</OkfPage>;
}

function ClientsLive({ data, meta, scope, locale }: { data: OkfReadResult; meta: OkfPageMeta; scope: OkfScope | null; locale: Language }) {
  useMinuteTick();
  useHotTitle(hotDeadlineCount(data, today()));
  const { connection } = useOkfConnection();
  const choices = useMemo(() => practiceClientChoices(scope, data.clients), [scope, data.clients]);
  // Karta klienta ide rovno do svojho klienta, bez výberu.
  const clientRoot = (key: string) => key.startsWith("client:") ? clientRootOf(scope, key.slice("client:".length)) : undefined;
  return <ClientsView groups={groupByClient(data.matters, data.inputs, data.clients)} meta={meta} locale={locale} actions={<TriageEntry />}
    choices={choices} activeId={connection?.activeWorkspaceId} clientRoot={clientRoot} />;
}

const reveal = (index: number): CSSProperties & Record<"--lw-i", number> => ({ "--lw-i": index });
const initials = (name: string) => name.split(/\s+/).filter((part) => /\p{L}/u.test(part[0] ?? "")).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "·";

/** Klienti ako karty s ich vecami; najbližšia lehota a jej naliehavosť z tej istej pamäte ako Dnes. */
/** `actions`: ďalšie vstupy vedľa novej veci (roztriedenie skúšobného klona). */
export function ClientsView({ groups, meta, locale: forced, actions, choices, activeId, clientRoot }: {
  groups: readonly ClientGroup[]; meta?: OkfPageMeta; locale?: Language; actions?: ReactNode;
  /** Prax: klienti na krátky výber pri „+ Nová vec“ a priečinok klienta z karty (MČ 16. 10. 2026). */
  choices?: readonly ClientChoice[]; activeId?: string | null; clientRoot?: (groupKey: string) => string | undefined;
}) {
  const current = useLocale();
  const locale = forced ?? current;
  const text = (key: string, params?: Record<string, string | number>) => t(`lawoss.lite.${key}`, locale, params);
  const now = today();
  return (
    <div className="lw-clients" data-lawoss-lite="clients">
      <header className="lw-clients-hero" style={reveal(0)}>
        <div>
          {meta ? <p className="lw-clients-topline"><LiveStamp meta={meta} locale={locale} /></p> : null}
          <h1 className="lw-h1">{text("clients_title")}</h1>
        </div>
        <div className="lw-clients-actions">
          {actions}
          <Link className="lw-btn" to={ATTACH_EXISTING_CLIENT_PATH}>{text("attach_existing_client")}</Link>
          <NewMatterAction className="lw-today-primary" locale={locale} choices={choices} activeId={activeId}>+ {text("new_matter")}</NewMatterAction>
        </div>
      </header>

      {groups.length === 0 ? <div className="lw-clients-empty" style={reveal(1)}>
        <FolderOpen aria-hidden size={28} />
        <p>{text("clients_empty")}</p>
      </div> : <div className="lw-clients-grid">
        {groups.map((group, index) => {
          const hot = group.matters.some((m) => matterUrgency(m.deadlines, now) === "hot");
          return (
            <section key={group.key} className="lw-clients-card" style={reveal(index + 1)} data-urgency={hot ? "hot" : undefined}>
              <header className="lw-clients-card-head">
                <span className="lw-matter-avatar" aria-hidden>{initials(group.client || text("client_unnamed"))}</span>
                <h2>{group.client || text("client_unnamed")}</h2>
                <span className="lw-matter-count">{group.matters.length}</span>
              </header>
              {group.matters.length === 0 ? <p className="lw-clients-none">{text("client_no_matters")} <NewMatterAction locale={locale} clientRoot={clientRoot?.(group.key)}>{text("new_matter")}</NewMatterAction></p> : null}
              <ul className="lw-clients-matters">
                {group.matters.map((m) => {
                  const own = m.deadlines.filter((d) => !isOfficeFile(d.file));
                  const next = nextDeadline(own, now);
                  const urgency = matterUrgency(own, now);
                  // Lehota po termíne alebo s neplatným dátumom má prednosť pred najbližšou budúcou.
                  const missed = own.some((d) => d.invalid || d.date < now);
                  return (
                    <li key={m.path}>
                      <Link className="lw-clients-matter" to={liteMatterLink(m.path)} data-urgency={urgency} title={m.title}>
                        <span className="lw-clients-dot" aria-hidden />
                        <span className="lw-clients-matter-main">
                          <span className="lw-clients-matter-title">{m.title}</span>
                          <small>{[m.matterRef, m.court].filter(Boolean).join(" · ")}</small>
                        </span>
                        {missed ? <span className="lw-today-chip" data-urgency="hot">{text("overdue")}</span>
                          : next ? <span className="lw-today-chip" data-urgency={urgencyOf(next, now)}>{text("matter_next_deadline", { date: formatDay(next, locale) })}</span>
                          : urgency ? <span className="sr-only">{text("urgent")}</span> : null}
                        <ArrowUpRight aria-hidden size={15} className="lw-clients-arrow" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>}
    </div>
  );
}
