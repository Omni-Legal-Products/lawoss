/** @jsxImportSource react */
import { Link } from "react-router-dom";

import { LawossLayout } from "../../shell/layout";
import { EXPERIMENT_FLAGS, EXPERIMENT_VIEWS } from "../../experiments/registry";
import { resetExperiments, setExperiment, useExperiment } from "../../experiments/store";

function FlagRow(props: { id: string; label: string; note: string; owner: string; stav: string }) {
  const on = useExperiment(props.id);
  return (
    <div className="lw-row lw-cols-exp">
      <span className="lw-no">{on ? "●" : "○"}</span>
      <span className="lw-t">
        {props.label}
        <small>{props.note}</small>
      </span>
      <span className="lw-ref">{props.owner}</span>
      <span className="lw-st">{props.stav}</span>
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
  return (
    <LawossLayout>
      <div className="lw-mockup">
        <b>EXPERIMENT</b>
        rozpracované · len na tomto stroji
      </div>
      <h1 className="lw-h1">Experimenty</h1>
      <p className="lw-lead">
        Prepínače zapínajú nedokončené správanie inde v aplikácii, zoznam nižšie vedie na obrazovky, ktoré sú zatiaľ len
        návrh. Nič odtiaľto sa nesynchronizuje a nič nesmie prísť pred klienta.
      </p>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Prepínače</h2>
          <span className="lw-meta">
            default vypnuté · uložené lokálne
            <button className="lw-reset" type="button" onClick={resetExperiments}>
              Vypnúť všetko
            </button>
          </span>
        </div>
        {EXPERIMENT_FLAGS.map((flag) => (
          <FlagRow key={flag.id} id={flag.id} label={flag.label} note={flag.note} owner={flag.owner} stav={flag.stav} />
        ))}
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Rozpracované pohľady</h2>
          <span className="lw-meta">fiktívne dáta — nie sú napojené na spisy</span>
        </div>
        {EXPERIMENT_VIEWS.map((view) => (
          <Link key={view.id} to={view.to} className="lw-row lw-cols-exp-view">
            <span className="lw-no">—</span>
            <span className="lw-t">
              {view.label}
              <small>{view.note}</small>
            </span>
            <span className="lw-ref">{view.owner}</span>
            <span className="lw-st">{view.stav}</span>
            <span className="lw-go">otvoriť</span>
          </Link>
        ))}
      </div>

      <div className="lw-note">
        <span>
          Nový experiment = <b>jeden riadok</b> v <span className="lw-mono">lawoss/experiments/registry.ts</span>.
        </span>
        <span>
          Zapnutie sa číta cez <span className="lw-mono">useExperiment(id)</span>.
        </span>
        <span>Zmazaný riadok = správanie sa už nedá oživiť zo starého profilu.</span>
      </div>
    </LawossLayout>
  );
}
