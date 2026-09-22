/** @jsxImportSource react */
import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";

import { LawossLayout } from "../../shell/layout";
import { EXPERIMENT_FLAGS, EXPERIMENT_VIEWS } from "../../experiments/registry";
import { resetExperiments, setExperiment, useExperiment } from "../../experiments/store";

function FlagRow(props: { id: string; label: string; note: string; owner: string; stav: string }) {
  const on = useExperiment(props.id);
  const locale = useLocale();
  return (
    <div className="lw-row lw-cols-exp">
      <span className="lw-no">{on ? "●" : "○"}</span>
      <span className="lw-t">
        {props.label}
        <small>{props.note}</small>
      </span>
      <span className="lw-ref">{props.owner}</span>
      <span className="lw-st">{t(statusKey(props.stav), locale)}</span>
      <span className="lw-go">
        <button
          className={`lw-switch ${on ? "on" : ""}`}
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={props.label}
          onClick={() => setExperiment(props.id, !on)}
        >
          <span className="lw-switch-knob" />
        </button>
      </span>
    </div>
  );
}

/**
 * Experimenty — the one place where unfinished LAWOSS work is switched on and
 * listed. Everything here is off by default and local to this machine.
 */
export function ExperimentyPage() {
  const locale = useLocale();
  return (
    <LawossLayout>
      <h1 className="lw-h1">{t("lawoss.shell.experiments", locale)}</h1>
      <p className="lw-lead">{t("lawoss.shell.intro", locale)}</p>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>{t("lawoss.shell.switches", locale)}</h2>
          <span className="lw-meta">
            {t("lawoss.shell.local_defaults", locale)}
            <button className="lw-reset" type="button" onClick={resetExperiments}>
              {t("lawoss.shell.disable_all", locale)}
            </button>
          </span>
        </div>
        {EXPERIMENT_FLAGS.length === 0 ? (
          <p className="lw-empty">{t("lawoss.shell.no_switches", locale)}</p>
        ) : (
          EXPERIMENT_FLAGS.map((flag) => (
            <FlagRow key={flag.id} id={flag.id} label={flag.label} note={flag.note} owner={flag.owner} stav={flag.stav} />
          ))
        )}
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>{t("lawoss.shell.views", locale)}</h2>
          <span className="lw-meta">{t("lawoss.shell.views_note", locale)}</span>
        </div>
        {EXPERIMENT_VIEWS.map((view) => (
          <Link key={view.id} to={view.to} className="lw-row lw-cols-exp-view">
            <span className="lw-no">—</span>
            <span className="lw-t">
              {view.label}
              <small>{view.note}</small>
            </span>
            <span className="lw-ref">{view.owner}</span>
            <span className="lw-st">{t(statusKey(view.stav), locale)}</span>
            <span className="lw-go">{t("lawoss.shell.open", locale)}</span>
          </Link>
        ))}
      </div>

      <div className="lw-note"><span>{t("lawoss.shell.registry_note", locale)}</span></div>
    </LawossLayout>
  );
}

function statusKey(value: string): string {
  return value === "v testovaní" ? "lawoss.shell.testing" : value === "na zlúčenie" ? "lawoss.shell.merge" : "lawoss.shell.draft";
}
