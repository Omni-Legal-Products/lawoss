/** @jsxImportSource react */
/**
 * Prehľad prípadu podľa oblasti a typu práce (alfa2 C2) na záložke Prehľad detailu prípadu.
 * Vykresľuje `buildMatterViews` (`lawoss/okf/views.ts`): spoločný základ + bloky rozpoznaných
 * typov, pri každej položke stav (slovo, nie farba), čas a klikateľný zdroj. Prázdna sekcia je
 * „Neevidované“, nikdy „žiadne“. Oprava typu zapisuje do poľa `tags` karty prípadu (volajúci).
 */
import { useState } from "react";
import { t, type Language } from "@/i18n";
import { cardList, tagsLineFrom, VIEW_FAMILIES, type ItemFlag, type ItemState, type MatterViews, type SectionId, type SourceRef, type ViewBlock, type ViewConflict, type ViewFamily, type ViewItem } from "../../../../../lawoss/okf/views";
import { formatDay } from "../okf/read-model";

/** Položky viditeľné bez rozbalenia; zvyšok je „Zobraziť všetko“. */
const VISIBLE = 3;

const BLOCK_TITLE: Record<ViewBlock["family"], string> = {
  base: "lawoss.lite.ov_block_base",
  procedural: "lawoss.lite.ov_block_procedural",
  corporate: "lawoss.lite.ov_block_corporate",
  ip: "lawoss.lite.ov_block_ip",
};
const SECTION_TITLE: Record<SectionId, string> = {
  client: "lawoss.lite.ov_s_client", parties: "lawoss.lite.ov_s_parties", responsible: "lawoss.lite.ov_s_responsible", status: "lawoss.lite.ov_s_status",
  phase: "lawoss.lite.ov_s_phase", next_step: "lawoss.lite.ov_s_next_step", dates: "lawoss.lite.ov_s_dates", documents: "lawoss.lite.ov_s_documents",
  actions: "lawoss.lite.ov_s_actions", court: "lawoss.lite.ov_s_court", case_number: "lawoss.lite.ov_s_case_number", deadlines: "lawoss.lite.ov_s_deadlines",
  hearings: "lawoss.lite.ov_s_hearings", filings: "lawoss.lite.ov_s_filings", decisions: "lawoss.lite.ov_s_decisions", evidence: "lawoss.lite.ov_s_evidence",
  chronology: "lawoss.lite.ov_s_chronology", entities: "lawoss.lite.ov_s_entities", ownership: "lawoss.lite.ov_s_ownership", change: "lawoss.lite.ov_s_change",
  corp_decisions: "lawoss.lite.ov_s_corp_decisions", instruments: "lawoss.lite.ov_s_instruments", milestones: "lawoss.lite.ov_s_milestones", rights: "lawoss.lite.ov_s_rights",
  owners: "lawoss.lite.ov_s_owners", territories: "lawoss.lite.ov_s_territories", registrations: "lawoss.lite.ov_s_registrations", renewals: "lawoss.lite.ov_s_renewals",
  licences: "lawoss.lite.ov_s_licences", disputes: "lawoss.lite.ov_s_disputes",
};
const STATE_TEXT: Record<ItemState, string> = {
  proposed: "lawoss.lite.ov_state_proposed", approved: "lawoss.lite.ov_state_approved", executed: "lawoss.lite.ov_state_executed", unknown: "lawoss.lite.ov_state_unknown",
};
const FLAG_TEXT: Record<ItemFlag, string> = {
  conflict: "lawoss.lite.ov_flag_conflict", unlogged: "lawoss.lite.ov_flag_unlogged", stale: "lawoss.lite.ov_flag_stale", overdue: "lawoss.lite.overdue", invalid: "lawoss.lite.due_invalid",
};
const CONFLICT_FIELD: Record<ViewConflict["field"], string> = {
  client: "lawoss.lite.ov_field_client", counterparty: "lawoss.lite.ov_field_counterparty", court: "lawoss.lite.ov_s_court",
  case_number: "lawoss.lite.ov_s_case_number", area: "lawoss.lite.ov_field_area", work_kind: "lawoss.lite.ov_field_work_kind",
};
/** Známe strojové značky položiek; neznáme (vlastné hodnoty agenta) sa ukážu tak, ako sú v súbore. */
const TAG_TEXT: Record<string, string> = {
  "role:client": "lawoss.lite.ov_role_client", "role:counterparty": "lawoss.lite.ov_role_counterparty",
  "role:representative": "lawoss.lite.ov_role_representative", "role:ubo": "lawoss.lite.ov_role_ubo",
  application: "lawoss.lite.ov_tag_application", registration: "lawoss.lite.ov_tag_registration", procedural_link: "lawoss.lite.ov_tag_procedural_link",
  filing: "lawoss.lite.ov_event_filing", hearing: "lawoss.lite.ov_event_hearing", decision: "lawoss.lite.ov_event_decision", delivery: "lawoss.lite.ov_event_delivery",
  request: "lawoss.lite.ov_event_request", call: "lawoss.lite.ov_event_call", email: "lawoss.lite.ov_event_email",
  "right:trademark": "lawoss.lite.ov_right_trademark", "right:copyright": "lawoss.lite.ov_right_copyright",
  "right:patent": "lawoss.lite.ov_right_patent", "right:design": "lawoss.lite.ov_right_design",
};
const tagText = (tag: string | undefined, locale: Language): string | undefined => {
  if (!tag || tag === "task") return undefined;
  const key = TAG_TEXT[tag];
  return key ? t(key, locale) : tag.replace(/^[a-z]+:/, "").replace(/_/g, " ");
};

export const familyNames = (families: readonly ViewFamily[], locale: Language): string => families.map((f) => t(BLOCK_TITLE[f], locale)).join(" · ");

type OpenSource = (file: string) => void;
/** Súbor sa dá otvoriť; priečinok (`memory/`) len ukazuje, kde sa údaj eviduje. */
const isFile = (path: string): boolean => Boolean(path) && !path.endsWith("/");
const where = (source: SourceRef): string => [source.file, source.field ?? source.section].filter(Boolean).join(" › ");

function SourceLink({ source, locale, onOpen }: { source: SourceRef; locale: Language; onOpen?: OpenSource }) {
  const when = source.updated ? t("lawoss.lite.ov_updated", locale, { date: formatDay(source.updated, locale) }) : t("lawoss.lite.ov_updated_unknown", locale);
  const title = `${t("lawoss.lite.ov_source", locale, { file: where(source) })} · ${when}`;
  const label = t("lawoss.lite.ov_source_short", locale);
  return onOpen && isFile(source.file)
    ? <button type="button" className="lw-views-source" data-lawoss-source={source.file} title={title} aria-label={title} onClick={() => onOpen(source.file)}>{label}</button>
    : <span className="lw-views-source" data-lawoss-source={source.file} title={title}>{label}</span>;
}

function Item({ item, locale, onOpen }: { item: ViewItem; locale: Language; onOpen?: OpenSource }) {
  const tag = tagText(item.tag, locale);
  return <li className="lw-views-item" data-state={item.state} data-flags={item.flags?.join(" ") || undefined}>
    <span className="lw-views-main">
      <span className="lw-views-label">{item.label}</span>
      {item.detail || tag ? <small>{[tag, item.detail].filter(Boolean).join(" · ")}</small> : null}
    </span>
    <span className="lw-views-meta">
      {item.date ? <span className="lw-matter-chip">{/^\d{4}-\d{2}-\d{2}$/.test(item.date) ? formatDay(item.date, locale) : item.date}</span> : null}
      {item.state ? <span className="lw-views-state" data-state={item.state}>{t(STATE_TEXT[item.state], locale)}</span> : null}
      {(item.flags ?? []).map((flag) => <span key={flag} className="lw-matter-flag" data-flag={flag}>{t(FLAG_TEXT[flag], locale)}</span>)}
      {item.document && onOpen ? <button type="button" className="lw-views-source" data-lawoss-document={item.document} title={t("lawoss.lite.ov_open_document", locale, { file: item.document })} onClick={() => onOpen(item.document ?? "")}>↗</button> : null}
      <SourceLink source={item.source} locale={locale} onOpen={onOpen} />
    </span>
  </li>;
}

function Block({ block, locale, onOpen }: { block: ViewBlock; locale: Language; onOpen?: OpenSource }) {
  return <section className="lw-matter-panel lw-views-block" data-lawoss-view={block.family}>
    <h2 className="lw-matter-section">{t(BLOCK_TITLE[block.family], locale)}</h2>
    <dl className="lw-views-sections">
      {block.sections.map((section) => <div key={section.id} className="lw-views-row" data-section={section.id} data-status={section.status}>
        <dt>{t(SECTION_TITLE[section.id], locale)}</dt>
        <dd>
          {section.status === "not_recorded"
            ? <p className="lw-views-missing">{t("lawoss.lite.ov_not_recorded", locale)}{section.where ? <> <SourceLink source={section.where} locale={locale} onOpen={onOpen} /></> : null}</p>
            : <>
              <ul className="lw-views-items">{section.items.slice(0, VISIBLE).map((item) => <Item key={item.key} item={item} locale={locale} onOpen={onOpen} />)}</ul>
              {section.items.length > VISIBLE ? <details className="lw-views-more">
                <summary>{t("lawoss.lite.ov_more", locale, { count: section.items.length })}</summary>
                <ul className="lw-views-items">{section.items.slice(VISIBLE).map((item) => <Item key={item.key} item={item} locale={locale} onOpen={onOpen} />)}</ul>
              </details> : null}
            </>}
        </dd>
      </div>)}
    </dl>
  </section>;
}

export type ViewsEdit = {
  /** Karta prípadu (scope-relatívna cesta) a jej súčasné `tags` (z frontmatteru) pre náhľad zápisu. */
  cardFile: string;
  tags?: string;
  disabled?: boolean;
  onSave: (families: ViewFamily[] | null) => Promise<void>;
};

function EditViews({ views, edit, locale, onClose }: { views: MatterViews; edit: ViewsEdit; locale: Language; onClose: () => void }) {
  const [chosen, setChosen] = useState<ViewFamily[]>(views.families);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const save = (families: ViewFamily[] | null) => {
    setState("busy");
    edit.onSave(families).then(onClose, () => setState("error"));
  };
  return <div className="lw-views-edit" data-lawoss-views-edit="">
    <p className="lw-views-edit-title">{t("lawoss.lite.ov_edit_title", locale)}</p>
    <div className="lw-views-edit-options">
      {VIEW_FAMILIES.map((family) => <label key={family}>
        <input type="checkbox" checked={chosen.includes(family)} onChange={(event) => setChosen((prev) => event.target.checked ? [...prev, family] : prev.filter((f) => f !== family))} />
        {t(BLOCK_TITLE[family], locale)}
      </label>)}
    </div>
    <p className="lw-views-edit-preview" data-lawoss-views-preview="">{t("lawoss.lite.ov_edit_preview", locale, { file: edit.cardFile, line: tagsLineFrom(cardList(edit.tags), chosen) })}</p>
    {state === "error" ? <p className="lw-status err" role="alert">{t("lawoss.lite.ov_edit_error", locale)}</p> : null}
    <div className="lw-views-edit-actions">
      <button type="button" className="lw-matter-action is-primary" disabled={edit.disabled || state === "busy"} onClick={() => save(chosen)}>{t("lawoss.lite.ov_edit_save", locale)}</button>
      {views.override ? <button type="button" className="lw-matter-action" disabled={edit.disabled || state === "busy"} onClick={() => save(null)}>{t("lawoss.lite.ov_edit_auto", locale)}</button> : null}
      <button type="button" className="lw-matter-action" onClick={onClose}>{t("lawoss.lite.ov_edit_cancel", locale)}</button>
    </div>
  </div>;
}

/** Hlavička (rozpoznaný typ, dôvody, oprava), rozpory a bloky prehľadu. */
export function MatterViewsPanel({ views, locale, onOpen, edit }: { views: MatterViews; locale: Language; onOpen?: OpenSource; edit?: ViewsEdit }) {
  const [editing, setEditing] = useState(false);
  const types = familyNames(views.families, locale);
  const headline = views.override ? t("lawoss.lite.ov_override", locale, { types: types || t("lawoss.lite.ov_block_base", locale) })
    : views.families.length ? t("lawoss.lite.ov_detected", locale, { types }) : t("lawoss.lite.ov_detected_base", locale);
  return <div className="lw-views" data-lawoss-views={views.families.join(" ") || "base"}>
    <div className="lw-views-head">
      <p className="lw-views-detected">{headline}</p>
      {views.reasons.length ? <details className="lw-views-reasons">
        <summary>{t("lawoss.lite.ov_reasons", locale)}</summary>
        <ul>{views.reasons.map((reason, i) => <li key={`${reason.via}/${i}`}>
          {t(BLOCK_TITLE[reason.family], locale)}: {reason.value} <SourceLink source={reason.source} locale={locale} onOpen={onOpen} />
        </li>)}</ul>
      </details> : null}
      {edit && !editing ? <button type="button" className="lw-matter-action" disabled={edit.disabled} onClick={() => setEditing(true)}>{t("lawoss.lite.ov_edit", locale)}</button> : null}
    </div>
    {edit && editing ? <EditViews views={views} edit={edit} locale={locale} onClose={() => setEditing(false)} /> : null}
    {views.conflicts.length ? <div className="lw-status warn lw-views-conflicts" role="status" data-lawoss-views-conflicts="">
      <strong>{t("lawoss.lite.ov_conflicts_title", locale)}</strong>
      <ul>{views.conflicts.map((conflict) => <li key={conflict.field} data-field={conflict.field}>
        {t(CONFLICT_FIELD[conflict.field], locale)}: {conflict.values.map((value, i) => <span key={`${value.source.file}/${i}`}>{i > 0 ? " ≠ " : ""}{value.value} <SourceLink source={value.source} locale={locale} onOpen={onOpen} /></span>)}
      </li>)}</ul>
    </div> : null}
    <div className="lw-views-blocks">
      {[views.base, ...views.blocks].map((block) => <Block key={block.family} block={block} locale={locale} onOpen={onOpen} />)}
    </div>
  </div>;
}
