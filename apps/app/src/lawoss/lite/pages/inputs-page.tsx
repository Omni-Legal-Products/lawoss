/** @jsxImportSource react */
/**
 * Podrobný zoznam „Na zaradenie“ (rozhodnutie MČ 23. 10. 2026, N-A3-2): Dnes ukazuje len počet a odkaz sem.
 * Riadky sú zoskupené podľa klienta a prípadu, dokument sa volá textom odkazu z `VSTUPY.md` (nie surovým Markdownom)
 * a v zozname sú len dokumenty, ktoré ešte nie sú v žiadnom prípade (`inputs-model.ts`). Len číta, nič nezapisuje.
 */
import { Link } from "react-router-dom";
import { Check, FileText } from "lucide-react";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { OkfPage } from "../../domains/okf-page";
import { formatDay } from "../../okf/read-model";
import { inputGroups, type InputGroup } from "../inputs-model";
import { LITE_TODAY_PATH } from "../links";
import { litePageProps } from "../state-text";
import { ChatBar, liteText } from "./today-page";
import "./okf-glass.css";
import "./today.css";

export function InputsPage() {
  const locale = useLocale();
  return <OkfPage {...litePageProps(locale)} title={t("lawoss.lite.inputs_title", locale)}>
    {(data) => <InputsView groups={inputGroups(data)} locale={locale} />}
  </OkfPage>;
}

export function InputsView({ groups, locale }: { groups: readonly InputGroup[]; locale: Language }) {
  const text = liteText(locale);
  const suggestions = [...(groups.length > 0 ? [text("chat_suggest_file")] : []), text("chat_suggest_today"), text("chat_suggest_week")];
  return <div className="lw-today lw-dnes" data-lawoss-lite="inputs">
    <p className="lw-today-lead">{text("inputs_page_lead")} <Link className="lw-dnes-more" to={LITE_TODAY_PATH}>{text("inputs_back")}</Link></p>
    {groups.length === 0 ? <section className="lw-dnes-panel"><p className="lw-today-empty"><Check aria-hidden size={15} />{text("inputs_empty")}</p></section> : groups.map((group) => (
      <section key={group.key} className="lw-dnes-panel" data-lawoss-inputs-client={group.key}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="lw-dnes-h2 mb-0"><Link to={group.link}>{group.client || text("client_unnamed")}</Link></h2>
          <span className="lw-dnes-pill">{group.rows.length}</span>
        </div>
        <ul className="lw-dnes-list">
          {group.rows.map((row, index) => (
            <li key={`${row.input.file}/${row.input.id}/${index}`}>
              <Link className="lw-dnes-item" to={row.link} data-lawoss-scope={row.input.scope}>
                <span className="lw-dnes-mini-icon" aria-hidden><FileText size={16} /></span>
                <span className="lw-dnes-item-text">
                  <b title={row.label}>{row.label}</b>
                  <span>{[row.matter ? row.matter.title : text("inputs_client_level"), row.input.id || null, row.input.received ? formatDay(row.input.received.slice(0, 10), locale) : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="lw-dnes-pill" data-tone="gold">{text("inputs_file")}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    ))}
    <ChatBar text={text} suggestions={suggestions} />
  </div>;
}
