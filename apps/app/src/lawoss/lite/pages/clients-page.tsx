/** @jsxImportSource react */
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, FolderOpen } from "lucide-react";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { OkfPage, type OkfPageMeta } from "../../domains/okf-page";
import { litePageProps } from "../state-text";
import { formatDay, today, type OkfReadResult } from "../../okf/read-model";
import { urgencyOf } from "../../okf/view-rules";
import { groupByClient, nextDeadline, type ClientGroup } from "../today-model";
import { liteMatterLink, NEW_MATTER_PATH } from "../links";
import { hotDeadlineCount, LiveStamp, matterUrgency, useHotTitle, useMinuteTick } from "../live";
import "./okf-glass.css";
import "./clients.css";

export function ClientsPage() {
  const locale = useLocale();
  return <OkfPage {...litePageProps(locale)}>{(data, meta) => <ClientsLive data={data} meta={meta} locale={locale} />}</OkfPage>;
}

function ClientsLive({ data, meta, locale }: { data: OkfReadResult; meta: OkfPageMeta; locale: Language }) {
  useMinuteTick();
  useHotTitle(hotDeadlineCount(data, today()));
  return <ClientsView groups={groupByClient(data.matters, data.inputs)} meta={meta} locale={locale} />;
}

const reveal = (index: number): CSSProperties & Record<"--lw-i", number> => ({ "--lw-i": index });
const initials = (name: string) => name.split(/\s+/).filter((part) => /\p{L}/u.test(part[0] ?? "")).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "·";

/** Klienti ako karty s ich vecami; najbližšia lehota a jej naliehavosť z tej istej pamäte ako Dnes. */
export function ClientsView({ groups, meta, locale: forced }: { groups: readonly ClientGroup[]; meta?: OkfPageMeta; locale?: Language }) {
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
        <Link className="lw-today-primary" to={NEW_MATTER_PATH}>+ {text("new_matter")}</Link>
      </header>

      {groups.length === 0 ? <div className="lw-clients-empty" style={reveal(1)}>
        <FolderOpen aria-hidden size={28} />
        <p>{text("clients_empty")}</p>
      </div> : <div className="lw-clients-grid">
        {groups.map((group, index) => {
          const hot = group.matters.some((m) => matterUrgency(m.deadlines, now) === "hot");
          return (
            <section key={group.client} className="lw-clients-card" style={reveal(index + 1)} data-urgency={hot ? "hot" : undefined}>
              <header className="lw-clients-card-head">
                <span className="lw-matter-avatar" aria-hidden>{initials(group.client)}</span>
                <h2>{group.client}</h2>
                <span className="lw-matter-count">{group.matters.length}</span>
              </header>
              <ul className="lw-clients-matters">
                {group.matters.map((m) => {
                  const next = nextDeadline(m.deadlines, now);
                  return (
                    <li key={m.path}>
                      <Link className="lw-clients-matter" to={liteMatterLink(m.path)} data-urgency={matterUrgency(m.deadlines, now)}>
                        <span className="lw-clients-dot" aria-hidden />
                        <span className="lw-clients-matter-main">
                          <span className="lw-clients-matter-title">{m.title}</span>
                          <small>{[m.matterRef, m.court].filter(Boolean).join(" · ")}</small>
                        </span>
                        {next ? <span className="lw-today-chip" data-urgency={urgencyOf(next, now)}>{text("matter_next_deadline", { date: formatDay(next, locale) })}</span> : null}
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
