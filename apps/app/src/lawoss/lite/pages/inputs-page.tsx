/** @jsxImportSource react */
/**
 * Podrobný zoznam „Na zaradenie“ (rozhodnutie MČ 23. 10. 2026, N-A3-2): Dnes ukazuje len počet a odkaz sem.
 * Riadky sú zoskupené podľa klienta a prípadu, dokument sa volá textom odkazu z `VSTUPY.md` (nie surovým Markdownom)
 * a v zozname sú len dokumenty, ktoré ešte nie sú v žiadnom prípade (`inputs-model.ts`). Len číta, nič nezapisuje.
 */
import { Link } from "react-router-dom";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { OkfPage } from "../../domains/okf-page";
import { formatDay } from "../../okf/read-model";
import { inputGroups, type InputGroup } from "../inputs-model";
import { LITE_TODAY_PATH } from "../links";
import { litePageProps } from "../state-text";

export function InputsPage() {
  const locale = useLocale();
  return <OkfPage {...litePageProps(locale)} title={t("lawoss.lite.inputs_title", locale)}>
    {(data) => <InputsView groups={inputGroups(data)} locale={locale} />}
  </OkfPage>;
}

export function InputsView({ groups, locale }: { groups: readonly InputGroup[]; locale: Language }) {
  const text = (key: string, params?: Record<string, string | number>) => t(`lawoss.lite.${key}`, locale, params);
  return <div data-lawoss-lite="inputs">
    <p className="lw-lead">{text("inputs_page_lead")} <Link to={LITE_TODAY_PATH}>{text("inputs_back")}</Link></p>
    {groups.length === 0 ? <p className="lw-empty">{text("inputs_empty")}</p> : groups.map((group) => (
      <div key={group.key} className="lw-reg" data-lawoss-inputs-client={group.key}>
        <div className="lw-reg-h">
          <h2><Link to={group.link}>{group.client || text("client_unnamed")}</Link></h2>
          <span className="lw-meta">{group.rows.length}</span>
        </div>
        {group.rows.map((row, index) => (
          <Link key={`${row.input.file}/${row.input.id}/${index}`} className="lw-row lw-cols-leh" to={row.link} data-lawoss-scope={row.input.scope}>
            <span className="lw-no">{row.input.id || "-"}</span>
            <span className="lw-d">{row.input.received ? formatDay(row.input.received.slice(0, 10), locale) : ""}</span>
            <span className="lw-t">
              {row.label}
              <small>{row.matter ? row.matter.title : text("inputs_client_level")}</small>
            </span>
            <span className="lw-ref" />
            <span className="lw-st">{text("inputs_file")}</span>
          </Link>
        ))}
      </div>
    ))}
  </div>;
}
