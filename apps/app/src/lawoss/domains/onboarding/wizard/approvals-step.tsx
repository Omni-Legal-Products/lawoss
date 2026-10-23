/** @jsxImportSource react */
/**
 * Krok 5 „Ako agent pracuje“ (C1): diagram Prečíta → Navrhne zmenu → Vy schválite → Vykoná, ukážka karty
 * schválenia a voľba režimu. Predvolené je schvaľovanie; YOLO je samostatná karta s existujúcim potvrdením
 * (texty `lawoss.yolo.confirm_*`) a rešpektuje zámok firmy. Zapisuje sa cez existujúce API (agent-mode.ts).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BookOpen, Check, CircleAlert, FilePen, Hand, ShieldCheck, TriangleAlert, UserCheck } from "lucide-react";
import { t, type Language } from "@/i18n";
import { FlowDiagram } from "./illustrations";
import { StepScreen } from "./wizard-frame";
import type { WizardText } from "./wizard-text";
import type { AgentState, FirmControl } from "./agent-mode";

/** Statická ukážka karty schválenia (nie skutočná karta, tlačidlá nič nerobia). */
export function ApprovalCardPreview({ text }: { text: WizardText }) {
  return (
    <figure className="lw-wiz-approval" aria-label={text("previewLabel")}>
      <div className="lw-wiz-approval-card" aria-hidden="true">
        <p className="lw-wiz-approval-title"><FilePen className="size-4" /> {text("previewTitle")}</p>
        <p className="lw-wiz-approval-change">
          <span className="lw-wiz-approval-from">{text("previewFrom")}</span>
          <span className="lw-wiz-approval-arrow">→</span>
          <span>{text("previewTo")}</span>
        </p>
        <p className="lw-wiz-approval-buttons">
          <span className="lw-wiz-fake-btn primary">{text("previewAllow")}</span>
          <span className="lw-wiz-fake-btn">{text("previewDeny")}</span>
        </p>
      </div>
      <figcaption>{text("previewLabel")}. {text("previewCaption")}</figcaption>
    </figure>
  );
}

export type ApprovalsViewProps = {
  text: WizardText;
  locale: Language;
  state: AgentState;
  canWrite: boolean;
  saving: boolean;
  failed: boolean;
  /** Kto smie meniť pravidlá zmien: advokát, advokát po uvoľnení firemného pravidla, alebo nikto (zámok firmy). */
  control: FirmControl;
  busy: boolean;
  nav?: ReactNode;
  onYolo: (enabled: boolean) => void;
  onAsk: () => void;
  onContinue: () => void;
};

export function ApprovalsStepView({ text, locale, state, canWrite, saving, failed, control, busy, nav, onYolo, onAsk, onContinue }: ApprovalsViewProps) {
  const [confirming, setConfirming] = useState(false);
  const group = useId(), confirmTitle = useId();
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  const yolo = state.yolo;
  const yoloOn = Boolean(yolo?.enabled);
  const locked = Boolean(yolo?.locked);
  const yoloDisabled = busy || saving || !yolo || locked || !canWrite;
  // Pri zmenách bez pýtania nie je vybraná ani jedna karta: obrazovka nesmie tvrdiť „pýta sa“ a zároveň varovať.
  const allow = !yoloOn && state.edits === "allow";
  const canAsk = allow && control !== "locked" && canWrite;
  const selected = yoloOn || confirming ? "yolo" : allow ? null : "ask";
  const yoloNote = locked ? text("modeLocked") : yolo && !canWrite ? text("modeHostOnly") : !yolo && !state.loading ? text("modeUnavailable") : null;
  const lead = yoloOn ? text("approvalsLeadYolo") : allow ? text("approvalsLeadAllow") : text("approvalsLead");
  // Potvrdenie YOLO dostane fokus hneď po otvorení (na bezpečné Zrušiť, nie na zapnutie); Escape ho zruší.
  useEffect(() => { if (confirming) confirmButton.current?.focus(); }, [confirming]);
  return (
    <StepScreen step="approvals" title={text("approvalsTitle")} lead={<p>{lead}</p>} nav={nav}
      details={<p>{text("approvalsDetails")}</p>} detailsLabel={text("details")}>
      <FlowDiagram label={text("flowLabel")} nodes={[
        { key: "read", icon: <BookOpen className="size-5" />, label: text("flowRead") },
        { key: "propose", icon: <FilePen className="size-5" />, label: text("flowPropose") },
        { key: "approve", icon: <UserCheck className="size-5" />, label: text("flowApprove"), emphasis: true },
        { key: "do", icon: <Check className="size-5" />, label: text("flowDo") },
      ]} />
      <ApprovalCardPreview text={text} />
      <fieldset className="lw-wiz-field" aria-busy={state.loading || saving}>
        <legend className="lw-wiz-label">{text("modeLabel")}</legend>
        <div className="lw-wiz-cards">
          <label className="lw-wiz-card-option" data-selected={selected === "ask" ? "true" : undefined}>
            <input type="radio" name={`${group}-mode`} checked={selected === "ask"} disabled={busy || saving || (yoloOn && yoloDisabled) || (allow && !canAsk)}
              onChange={() => { setConfirming(false); if (yoloOn) onYolo(false); else if (allow) onAsk(); }} />
            <span>
              <strong><ShieldCheck className="size-4" aria-hidden /> {text("modeAsk")} <span className="lw-wiz-tag">{text("recommended")}</span>{allow ? <span className="lw-wiz-tag" data-tone="warn">{text("modeAllowNow")}</span> : null}</strong>
              <small>{text("modeAskHint")}</small>
            </span>
          </label>
          <label className="lw-wiz-card-option lw-wiz-card-yolo" data-selected={selected === "yolo" ? "true" : undefined}>
            <input type="radio" name={`${group}-mode`} checked={selected === "yolo"} disabled={yoloDisabled}
              onChange={() => { if (!yoloOn) setConfirming(true); }} />
            <span>
              <strong><Hand className="size-4" aria-hidden /> {text("modeYolo")}</strong>
              <small>{text("modeYoloHint")}</small>
              {yoloOn ? <small className="lw-wiz-warn-text"><TriangleAlert className="size-3.5" aria-hidden /> {text("modeYoloOn")}</small> : null}
              {yoloNote ? <small>{yoloNote}</small> : null}
            </span>
          </label>
        </div>
      </fieldset>
      {confirming && !yoloOn ? (
        <div role="alertdialog" aria-labelledby={confirmTitle} className="lw-wiz-confirm" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setConfirming(false); } }}>
          <p id={confirmTitle} className="font-medium">{t("lawoss.yolo.confirm_title", locale)}</p>
          <p>{t("lawoss.yolo.confirm_body", locale)}</p>
          <p>{t("lawoss.yolo.confirm_clients", locale)}</p>
          <p className="font-medium">{t("lawoss.yolo.confirm_undo", locale)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="lw-btn lw-btn-danger" disabled={saving} onClick={() => { setConfirming(false); onYolo(true); }}>{t("lawoss.yolo.confirm_on", locale)}</button>
            <button ref={confirmButton} type="button" className="lw-btn" disabled={saving} onClick={() => setConfirming(false)}>{t("lawoss.yolo.confirm_cancel", locale)}</button>
          </div>
        </div>
      ) : null}
      {allow ? (
        <div className="lw-wiz-note" data-tone="warn">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{text(control === "own" ? "permAllow" : "permFirm")}</span>
        </div>
      ) : null}
      {saving ? <p role="status" className="text-sm text-muted-foreground">{text("modeSaving")}</p> : null}
      {failed ? <p role="alert" className="lw-status err">{text("modeFailed")}</p> : null}
      {/* Hlavná akcia vedie vždy k bezpečnému stavu: pri zmenách bez pýtania najprv zapnúť schvaľovanie. */}
      <div className="lw-wiz-actions">
        {canAsk ? <button type="button" className="lw-btn gold" disabled={busy || saving || confirming} onClick={onAsk}>{text("permAsk")}</button> : null}
        <button type="button" className={canAsk ? "lw-btn" : "lw-btn gold"} disabled={busy || saving || confirming} onClick={onContinue}>{text("continue")}</button>
      </div>
    </StepScreen>
  );
}
