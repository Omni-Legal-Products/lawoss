/** @jsxImportSource react */
/**
 * Prehľad prípadu podľa oblasti a typu práce (alfa2 C2) na záložke Prehľad detailu prípadu.
 * Vykresľuje `buildMatterViews` (`lawoss/okf/views.ts`): stavová lišta, spoločný základ a bloky
 * rozpoznaných typov (najviac dva otvorené, ďalší zbalený). Pri každej položke stav (slovo, nie
 * farba), zdroj s časom aktualizácie a otvorenie súboru len v priečinku klienta prípadu.
 * Prázdne sekcie bloku sú jeden riadok „Neevidované: …“; nečerstvé čítanie „Nenačítané: …“.
 * Oprava typu zapisuje do poľa `tags` karty prípadu; náhľad aj zápis používajú ten istý čerstvo prečítaný text.
 */
import { useEffect, useState } from "react";
import { t, type Language } from "@/i18n";
import { viewTagsLine, VIEW_FAMILIES, type ItemFlag, type ItemState, type MatterViews, type SectionId, type SourceRef, type ViewBlock, type ViewConflict, type ViewFamily, type ViewItem, type ViewSection } from "../../../../../lawoss/okf/views";

/** Položky viditeľné bez rozbalenia; zvyšok je „Zobraziť všetko“. */
const VISIBLE = 3;
/** Otvorené bloky (základ + prvý odborný); ďalšie sú zbalené. */
const OPEN_BLOCKS = 2;

const BLOCK_TITLE: Record<ViewBlock["family"], string> = {
  base: "lawoss.lite.ov_block_base",
  procedural: "lawoss.lite.ov_block_procedural",
  corporate: "lawoss.lite.ov_block_corporate",
  ip: "lawoss.lite.ov_block_ip",
};
const SECTION_TITLE: Record<SectionId, string> = {
  client: "lawoss.lite.ov_s_client", parties: "lawoss.lite.ov_s_parties", responsible: "lawoss.lite.ov_s_responsible", status: "lawoss.lite.ov_s_status",
  phase: "lawoss.lite.ov_s_phase", next_step: "lawoss.lite.ov_s_next_step", next_date: "lawoss.lite.ov_s_next_date", dates: "lawoss.lite.ov_s_dates",
  documents: "lawoss.lite.ov_s_documents", actions: "lawoss.lite.ov_s_actions", court: "lawoss.lite.ov_s_court", case_number: "lawoss.lite.ov_s_case_number",
  deadlines: "lawoss.lite.ov_s_deadlines", hearings: "lawoss.lite.ov_s_hearings", filings: "lawoss.lite.ov_s_filings", decisions: "lawoss.lite.ov_s_decisions",
  evidence: "lawoss.lite.ov_s_evidence", chronology: "lawoss.lite.ov_s_chronology", entities: "lawoss.lite.ov_s_entities", ownership: "lawoss.lite.ov_s_ownership",
  change: "lawoss.lite.ov_s_change", corp_decisions: "lawoss.lite.ov_s_corp_decisions", instruments: "lawoss.lite.ov_s_instruments", milestones: "lawoss.lite.ov_s_milestones",
  rights: "lawoss.lite.ov_s_rights", owners: "lawoss.lite.ov_s_owners", territories: "lawoss.lite.ov_s_territories", registrations: "lawoss.lite.ov_s_registrations",
  renewals: "lawoss.lite.ov_s_renewals", licences: "lawoss.lite.ov_s_licences", disputes: "lawoss.lite.ov_s_disputes",
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
const VIA_TEXT: Record<MatterViews["reasons"][number]["via"], string> = {
  override: "lawoss.lite.ov_via_override", work_kind: "lawoss.lite.ov_via_work_kind", area: "lawoss.lite.ov_via_area", office_area: "lawoss.lite.ov_via_office_area",
  court: "lawoss.lite.ov_via_court", case_number: "lawoss.lite.ov_via_case_number", history: "lawoss.lite.ov_via_history", record_type: "lawoss.lite.ov_via_record_type",
};
/**
 * Strojové značky z `views.ts` → statické kľúče prekladu. Hodnoty schémy sú konečné; neznáma
 * hodnota (vlastná hodnota agenta, napr. iný druh práva) sa ukáže tak, ako je zapísaná v súbore.
 */
const TAG_TEXT: Record<string, string> = {
  "role:client": "lawoss.lite.ov_role_client", "role:counterparty": "lawoss.lite.ov_role_counterparty",
  "role:representative": "lawoss.lite.ov_role_representative", "role:ubo": "lawoss.lite.ov_role_ubo",
  "relation:executive": "lawoss.lite.ov_relation_executive", "relation:board_member": "lawoss.lite.ov_relation_board_member",
  "relation:shareholder": "lawoss.lite.ov_relation_shareholder", "relation:representative": "lawoss.lite.ov_relation_representative",
  "relation:attorney_in_fact": "lawoss.lite.ov_relation_attorney_in_fact", "relation:beneficial_owner": "lawoss.lite.ov_relation_beneficial_owner",
  "relation:pledgee": "lawoss.lite.ov_relation_pledgee",
  "type:decision": "lawoss.lite.ov_type_decision", "type:requirement": "lawoss.lite.ov_type_requirement",
  "type:ip_right": "lawoss.lite.ov_type_ip_right", "type:relation": "lawoss.lite.ov_type_relation",
  "instrument:draft": "lawoss.lite.ov_instrument_draft", "instrument:negotiated": "lawoss.lite.ov_instrument_negotiated",
  "instrument:final": "lawoss.lite.ov_instrument_final", "instrument:signed": "lawoss.lite.ov_instrument_signed",
  "instrument:effective": "lawoss.lite.ov_instrument_effective", "instrument:registered": "lawoss.lite.ov_instrument_registered",
  "instrument:superseded": "lawoss.lite.ov_instrument_superseded",
  "form:plain": "lawoss.lite.ov_form_plain", "form:certified_signature": "lawoss.lite.ov_form_certified_signature",
  "form:notarial_deed": "lawoss.lite.ov_form_notarial_deed", "form:attorney_declaration": "lawoss.lite.ov_form_attorney_declaration",
  "evidence:proposed": "lawoss.lite.ov_evidence_proposed", "evidence:taken": "lawoss.lite.ov_evidence_taken",
  "fulfillment:open": "lawoss.lite.ov_fulfillment_open", "fulfillment:met": "lawoss.lite.ov_fulfillment_met",
  "fulfillment:waived": "lawoss.lite.ov_fulfillment_waived", "fulfillment:failed": "lawoss.lite.ov_fulfillment_failed",
  "right:trademark": "lawoss.lite.ov_right_trademark", "right:copyright": "lawoss.lite.ov_right_copyright",
  "right:patent": "lawoss.lite.ov_right_patent", "right:design": "lawoss.lite.ov_right_design",
  "right_status:filed": "lawoss.lite.ov_right_status_filed", "right_status:published": "lawoss.lite.ov_right_status_published",
  "right_status:registered": "lawoss.lite.ov_right_status_registered", "right_status:opposed": "lawoss.lite.ov_right_status_opposed",
  "right_status:expired": "lawoss.lite.ov_right_status_expired",
  "kind:dispute": "lawoss.lite.ov_kind_dispute", "kind:advisory": "lawoss.lite.ov_kind_advisory", "kind:transaction": "lawoss.lite.ov_kind_transaction",
  "kind:other": "lawoss.lite.ov_kind_other", "kind:contentious": "lawoss.lite.ov_kind_contentious", "kind:non_contentious": "lawoss.lite.ov_kind_non_contentious",
  "view:procedural": "lawoss.lite.ov_block_procedural", "view:corporate": "lawoss.lite.ov_block_corporate", "view:ip": "lawoss.lite.ov_block_ip", "view:base": "lawoss.lite.ov_block_base",
  "scope:office": "lawoss.lite.ov_scope_office",
  application: "lawoss.lite.ov_tag_application", registration: "lawoss.lite.ov_tag_registration", procedural_link: "lawoss.lite.ov_tag_procedural_link",
  filing: "lawoss.lite.ov_event_filing", hearing: "lawoss.lite.ov_event_hearing", decision: "lawoss.lite.ov_event_decision", delivery: "lawoss.lite.ov_event_delivery",
  request: "lawoss.lite.ov_event_request", call: "lawoss.lite.ov_event_call", email: "lawoss.lite.ov_event_email",
};
export const tagText = (tag: string, locale: Language): string | undefined => {
  if (tag === "task") return undefined;
  const key = TAG_TEXT[tag];
  return key ? t(key, locale) : tag.replace(/^[a-z_]+:/, "").replace(/_/g, " ");
};

export const familyNames = (families: readonly ViewFamily[], locale: Language): string => families.map((f) => t(BLOCK_TITLE[f], locale)).join(" · ");

/** Otvorenie zdroja: `canOpen` povie, či súbor patrí priečinku klienta prípadu; inak sa zdroj len ukáže. */
export type SourceAccess = { open: (file: string) => void; canOpen: (file: string) => boolean };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const shortDay = (iso: string, locale: Language): string =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const where = (source: SourceRef): string => [source.file, source.field ?? source.section].filter(Boolean).join(" › ");

function SourceLink({ source, locale, access }: { source: SourceRef; locale: Language; access?: SourceAccess }) {
  const when = source.updated && ISO.test(source.updated) ? shortDay(source.updated, locale) : undefined;
  const label = `${t("lawoss.lite.ov_source_short", locale)}${when ? ` · ${when}` : ""}`;
  const updated = when ? t("lawoss.lite.ov_updated", locale, { date: when }) : t("lawoss.lite.ov_updated_unknown", locale);
  if (access && source.file && !source.file.endsWith("/") && access.canOpen(source.file)) {
    const title = `${t("lawoss.lite.ov_source", locale, { file: where(source) })} · ${updated}`;
    return <button type="button" className="lw-views-source" data-lawoss-source={source.file} title={title} aria-label={title} onClick={() => access.open(source.file)}>{label}</button>;
  }
  // Priečinok, kancelária alebo cudzí priečinok: len text s cestou a vysvetlením, nikdy nefunkčné tlačidlo.
  const note = source.file.endsWith("/") ? `${where(source)} · ${updated}` : `${t("lawoss.lite.ov_source_static", locale, { file: where(source) })} · ${updated}`;
  return <span className="lw-views-source is-static" data-lawoss-source={source.file} data-static="" title={note} aria-label={note}>{label}</span>;
}

function Item({ item, locale, access }: { item: ViewItem; locale: Language; access?: SourceAccess }) {
  const tags = (item.tags ?? []).map((tag) => tagText(tag, locale)).filter(Boolean);
  const valid = item.date && ISO.test(item.date) && !item.flags?.includes("invalid");
  return <li className="lw-views-item" data-state={item.state} data-flags={item.flags?.join(" ") || undefined}>
    <span className="lw-views-main">
      <span className="lw-views-label">{item.label}</span>
      {item.detail || tags.length ? <small>{[...tags, item.detail].filter(Boolean).join(" · ")}</small> : null}
    </span>
    <span className="lw-views-meta">
      {valid && item.date ? <span className="lw-matter-chip">{shortDay(item.date, locale)}</span>
        : item.date && item.flags?.includes("invalid") ? <span className="lw-matter-chip" data-invalid="">? {item.date}</span> : null}
      {item.state ? <span className="lw-views-state" data-state={item.state}>{t(STATE_TEXT[item.state], locale)}</span> : null}
      {(item.flags ?? []).map((flag) => <span key={flag} className="lw-matter-flag" data-flag={flag}>{t(FLAG_TEXT[flag], locale)}</span>)}
      {item.document && access?.canOpen(item.document) ? <button type="button" className="lw-views-source" data-lawoss-document={item.document}
        title={t("lawoss.lite.ov_open_document", locale, { file: item.document })} aria-label={t("lawoss.lite.ov_open_document", locale, { file: item.document })}
        onClick={() => access.open(item.document ?? "")}>↗</button> : null}
      <SourceLink source={item.source} locale={locale} access={access} />
    </span>
  </li>;
}

function Items({ items, locale, access }: { items: readonly ViewItem[]; locale: Language; access?: SourceAccess }) {
  return <>
    <ul className="lw-views-items">{items.slice(0, VISIBLE).map((item) => <Item key={item.key} item={item} locale={locale} access={access} />)}</ul>
    {items.length > VISIBLE ? <details className="lw-views-more">
      <summary>{t("lawoss.lite.ov_more", locale, { count: items.length })}</summary>
      <ul className="lw-views-items">{items.slice(VISIBLE).map((item) => <Item key={item.key} item={item} locale={locale} access={access} />)}</ul>
    </details> : null}
  </>;
}

/** Prázdne sekcie bloku v jednom riadku: „Neevidované: …“, pri nečerstvom čítaní „Nenačítané: …“. */
function Missing({ sections, locale, failed }: { sections: readonly ViewSection[]; locale: Language; failed: boolean }) {
  if (!sections.length) return null;
  const names = sections.map((s) => t(SECTION_TITLE[s.id], locale)).join(", ");
  return <p className="lw-views-missing" data-lawoss-missing={sections.map((s) => s.id).join(" ")} data-read={failed ? "failed" : undefined}>
    {t(failed ? "lawoss.lite.ov_not_loaded_list" : "lawoss.lite.ov_not_recorded_list", locale, { sections: names })}
  </p>;
}

function Block({ block, locale, access, failed }: { block: ViewBlock; locale: Language; access?: SourceAccess; failed: boolean }) {
  const recorded = block.sections.filter((s): s is Extract<ViewSection, { status: "recorded" }> => s.status === "recorded");
  return <section className="lw-matter-panel lw-views-block" data-lawoss-view={block.family}>
    <h2 className="lw-matter-section">{t(BLOCK_TITLE[block.family], locale)}</h2>
    {recorded.length ? <dl className="lw-views-sections">
      {recorded.map((section) => <div key={section.id} className="lw-views-row" data-section={section.id} data-status="recorded">
        <dt>{t(SECTION_TITLE[section.id], locale)}</dt>
        <dd><Items items={section.items} locale={locale} access={access} /></dd>
      </div>)}
    </dl> : null}
    <Missing sections={block.sections.filter((s) => s.status === "not_recorded")} locale={locale} failed={failed} />
  </section>;
}

/** Krátka stavová lišta nad blokmi: stav, fáza, ďalší krok, najbližší termín. */
function Strip({ sections, locale, access, failed }: { sections: readonly ViewSection[]; locale: Language; access?: SourceAccess; failed: boolean }) {
  return <dl className="lw-views-strip" data-lawoss-views-strip="">
    {sections.map((section) => <div key={section.id} data-section={section.id} data-status={section.status}>
      <dt>{t(SECTION_TITLE[section.id], locale)}</dt>
      <dd>{section.status === "recorded" ? section.items.slice(0, 1).map((item) => <span key={item.key} className="lw-views-strip-item">
        <span>{item.label}{item.date && ISO.test(item.date) && section.id === "next_date" ? ` · ${shortDay(item.date, locale)}` : ""}</span>
        {(item.flags ?? []).map((flag) => <span key={flag} className="lw-matter-flag" data-flag={flag}>{t(FLAG_TEXT[flag], locale)}</span>)}
        <SourceLink source={item.source} locale={locale} access={access} />
      </span>) : <span className="lw-views-missing">{t(failed ? "lawoss.lite.ov_not_loaded" : "lawoss.lite.ov_not_recorded", locale)}</span>}</dd>
    </div>)}
  </dl>;
}

export type ViewsEdit = {
  /** Karta prípadu (cesta voči koreňu prehľadu) — ukazuje sa v náhľade zápisu. */
  cardFile: string;
  disabled?: boolean;
  /** Čerstvo prečíta kartu; náhľad aj zápis používajú presne tento text (zápis s kontrolou, že sa nezmenil). */
  load: () => Promise<string>;
  save: (before: string, families: ViewFamily[] | null) => Promise<void>;
};

function EditViews({ views, edit, locale, onClose, onSaved }: { views: MatterViews; edit: ViewsEdit; locale: Language; onClose: () => void; onSaved: () => void }) {
  const [chosen, setChosen] = useState<ViewFamily[]>(views.families);
  const [card, setCard] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "busy" | "error">("loading");
  useEffect(() => {
    let alive = true;
    edit.load().then((content) => { if (alive) { setCard(content); setState("idle"); } }, () => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, []); // karta sa číta raz pri otvorení úpravy; náhľad aj zápis používajú tento text
  const line = (families: ViewFamily[] | null): string | null => {
    if (card === null) return null;
    try { return viewTagsLine(card, families); } catch { return null; }
  };
  const preview = line(chosen);
  const save = (families: ViewFamily[] | null) => {
    if (card === null || line(families) === null) { setState("error"); return; }
    setState("busy");
    edit.save(card, families).then(() => { onSaved(); onClose(); }, () => setState("error"));
  };
  return <div className="lw-views-edit" data-lawoss-views-edit="">
    <p className="lw-views-edit-title">{t("lawoss.lite.ov_edit_title", locale)}</p>
    <div className="lw-views-edit-options">
      {VIEW_FAMILIES.map((family) => <label key={family}>
        <input type="checkbox" checked={chosen.includes(family)} onChange={(event) => setChosen((prev) => event.target.checked ? [...prev, family] : prev.filter((f) => f !== family))} />
        {t(BLOCK_TITLE[family], locale)}
      </label>)}
    </div>
    {state === "loading" ? <p className="lw-views-edit-preview">{t("lawoss.lite.ov_edit_loading", locale)}</p>
      : preview ? <p className="lw-views-edit-preview" data-lawoss-views-preview="">{t("lawoss.lite.ov_edit_preview", locale, { file: edit.cardFile, line: preview })}</p> : null}
    {state === "error" || (state !== "loading" && card !== null && preview === null) ? <p className="lw-status err" role="alert">{t("lawoss.lite.ov_edit_error", locale)}</p> : null}
    <div className="lw-views-edit-actions">
      <button type="button" className="lw-matter-action is-primary" disabled={edit.disabled || state !== "idle" || !preview} onClick={() => save(chosen)}>{t("lawoss.lite.ov_edit_save", locale)}</button>
      {views.override ? <button type="button" className="lw-matter-action" disabled={edit.disabled || state !== "idle"} onClick={() => save(null)}>{t("lawoss.lite.ov_edit_auto", locale)}</button> : null}
      <button type="button" className="lw-matter-action" onClick={onClose}>{t("lawoss.lite.ov_edit_cancel", locale)}</button>
    </div>
  </div>;
}

function reasonValue(reason: MatterViews["reasons"][number], locale: Language): string {
  return reason.tag ? tagText(reason.tag, locale) ?? reason.value : reason.value;
}

/** Hlavička (rozpoznaný typ, dôvody, oprava), rozpory, stavová lišta a bloky prehľadu. */
export function MatterViewsPanel({ views, locale, access, edit, readState = "fresh" }: {
  views: MatterViews; locale: Language; access?: SourceAccess; edit?: ViewsEdit;
  /** `failed`: zdroj klienta sa nepodarilo čerstvo prečítať — prázdne sekcie sú „nenačítané“, nie „neevidované“. */
  readState?: "fresh" | "failed";
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const failed = readState === "failed";
  const types = familyNames(views.families, locale);
  const headline = views.override ? t("lawoss.lite.ov_override", locale, { types: types || t("lawoss.lite.ov_block_base", locale) })
    : views.families.length ? t("lawoss.lite.ov_detected", locale, { types }) : t("lawoss.lite.ov_detected_base", locale);
  const blocks = [views.base, ...views.blocks];
  return <div className="lw-views" data-lawoss-views={views.families.join(" ") || "base"} data-read={readState}>
    <div className="lw-views-head">
      <p className="lw-views-detected">{headline}</p>
      {views.reasons.length ? <details className="lw-views-reasons">
        <summary>{t("lawoss.lite.ov_reasons", locale)}</summary>
        <ul>{views.reasons.map((reason, i) => <li key={`${reason.via}/${i}`}>
          {t(BLOCK_TITLE[reason.family], locale)}: {t(VIA_TEXT[reason.via], locale)} „{reasonValue(reason, locale)}“ <SourceLink source={reason.source} locale={locale} access={access} />
        </li>)}</ul>
      </details> : null}
      {edit && !editing ? <button type="button" className="lw-matter-action" disabled={edit.disabled} onClick={() => { setSaved(false); setEditing(true); }}>{t("lawoss.lite.ov_edit", locale)}</button> : null}
      {saved ? <span className="lw-status ok" role="status" data-lawoss-views-saved="">{t("lawoss.lite.ov_edit_saved", locale)}</span> : null}
    </div>
    {edit && editing ? <EditViews views={views} edit={edit} locale={locale} onClose={() => setEditing(false)} onSaved={() => setSaved(true)} /> : null}
    {views.conflicts.length ? <div className="lw-status warn lw-views-conflicts" role="status" data-lawoss-views-conflicts="">
      <strong>{t("lawoss.lite.ov_conflicts_title", locale)}</strong>
      <ul>{views.conflicts.map((conflict, n) => <li key={`${conflict.field}/${n}`} data-field={conflict.field}>
        {t(CONFLICT_FIELD[conflict.field], locale)}: {conflict.values.map((value, i) => <span key={`${value.source.file}/${i}`}>{i > 0 ? " ≠ " : ""}{value.tag ? tagText(value.tag, locale) ?? value.value : value.value} <SourceLink source={value.source} locale={locale} access={access} /></span>)}
      </li>)}</ul>
    </div> : null}
    <Strip sections={views.strip} locale={locale} access={access} failed={failed} />
    <div className="lw-views-blocks">
      {blocks.slice(0, OPEN_BLOCKS).map((block) => <Block key={block.family} block={block} locale={locale} access={access} failed={failed} />)}
    </div>
    {blocks.slice(OPEN_BLOCKS).map((block) => <details key={block.family} className="lw-views-collapsed" data-lawoss-view-collapsed={block.family}>
      <summary>{t(BLOCK_TITLE[block.family], locale)}</summary>
      <Block block={block} locale={locale} access={access} failed={failed} />
    </details>)}
  </div>;
}
