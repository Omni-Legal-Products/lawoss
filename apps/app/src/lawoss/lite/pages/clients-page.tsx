/** @jsxImportSource react */
import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { OkfPage } from "../../domains/okf-page";
import { litePageProps } from "../state-text";
import { formatDay, today } from "../../okf/read-model";
import { groupByClient, nextDeadline, type ClientGroup } from "../today-model";
import { liteMatterLink, NEW_MATTER_PATH } from "../links";

export function ClientsPage() {
  const locale = useLocale();
  return <OkfPage title={t("lawoss.lite.clients_title", locale)} {...litePageProps(locale)}>{(data) => <ClientsView groups={groupByClient(data.matters, data.inputs)} />}</OkfPage>;
}

export function ClientsView({ groups }: { groups: readonly ClientGroup[] }) {
  const locale = useLocale();
  const now = today();
  return (
    <div data-lawoss-lite="clients">
      {groups.length === 0 ? <p className="lw-empty">{t("lawoss.lite.clients_empty", locale)}</p> : groups.map((group) => (
        <div key={group.client} className="lw-reg">
          <div className="lw-reg-h"><h2>{group.client}</h2></div>
          {group.matters.map((m) => {
            const next = nextDeadline(m.deadlines, now);
            return (
              <Link key={m.path} className="lw-row lw-cols-leh" to={liteMatterLink(m.path)}>
                <span className="lw-no" />
                <span className="lw-d">{m.lastEvent ? formatDay(m.lastEvent.date, locale) : "—"}</span>
                <span className="lw-t">{m.title}<small>{[m.court, next ? t("lawoss.lite.matter_next_deadline", locale, { date: formatDay(next, locale) }) : null].filter(Boolean).join(" · ")}</small></span>
                <span className="lw-ref">{m.matterRef ?? ""}</span>
                <span className="lw-st" />
              </Link>
            );
          })}
        </div>
      ))}
      <p><Link className="lw-btn" to={NEW_MATTER_PATH}>+ {t("lawoss.lite.new_matter", locale)}</Link></p>
    </div>
  );
}
