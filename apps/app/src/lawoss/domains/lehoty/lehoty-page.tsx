/** @jsxImportSource react */
import { Link } from "react-router-dom";

import { LawossLayout } from "../../shell/layout";

/**
 * Lehoty — fáza B mockup (fictional data). Real data comes from `lehoty.md`
 * front-matter per matter (spec 0005) in fáza C3; confirming a candidate opens
 * the decision gate and calls the `lehoty` skill (write + ICS + audit).
 */
export function LehotyPage() {
  return (
    <LawossLayout>
      <div className="lw-mockup">
        <b>NÁVRH</b>
        fiktívne dáta · fáza C3
      </div>
      <h1 className="lw-h1">Lehoty</h1>
      <p className="lw-lead">
        Register lehôt zo všetkých spisov. Kandidáti od agenta sa stávajú lehotami až po vašom potvrdení v rozhodovacej
        bráne — s citáciou predpisu, výpočtom a auditnou stopou.
      </p>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Čaká na potvrdenie</h2>
          <span className="lw-meta">1 kandidát · stav needs_review</span>
        </div>
        <Link className="lw-row lw-cols-leh" to="/session">
          <span className="lw-no">14.</span>
          <span className="lw-d soon">7. 6.</span>
          <span className="lw-t">
            Lehota na odvolanie
            <small>ABC s.r.o. v. DEF a.s. · doručenie 23. 5. · 15 dní kalendárnych · výpočet deterministický</small>
          </span>
          <span className="lw-ref">§ 362 ods. 1 CSP · Slov-Lex ✓</span>
          <span className="lw-st ai">otvoriť bránu</span>
        </Link>
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Potvrdené</h2>
          <span className="lw-meta">
            zapísané v spise + ICS
            <a href="#ics">Exportovať ICS</a>
          </span>
        </div>
        <div className="lw-row lw-cols-leh">
          <span className="lw-no">1.</span>
          <span className="lw-d urg">zajtra</span>
          <span className="lw-t">
            Žaloba o náhradu škody
            <small>Novák v. Poisťovňa · 2024-03 Poisťovňa - náhrada škody</small>
          </span>
          <span className="lw-ref">Okresný súd Bratislava I</span>
          <span className="lw-st ok">potvrdené</span>
        </div>
        <div className="lw-row lw-cols-leh">
          <span className="lw-no">2.</span>
          <span className="lw-d soon">pi 23. 5.</span>
          <span className="lw-t">
            Vyjadrenie k žalobe
            <small>Kováč / rozvod</small>
          </span>
          <span className="lw-ref">Okresný súd Trnava</span>
          <span className="lw-st ok">potvrdené</span>
        </div>
        <div className="lw-row lw-cols-leh">
          <span className="lw-no">3.</span>
          <span className="lw-d">ne 25. 5.</span>
          <span className="lw-t">
            Odvolanie
            <small>STAV s.r.o. v. Mesto Žilina</small>
          </span>
          <span className="lw-ref">Krajský súd Žilina</span>
          <span className="lw-st ok">potvrdené</span>
        </div>
        <div className="lw-row lw-cols-leh">
          <span className="lw-no">4.</span>
          <span className="lw-d">po 2. 6.</span>
          <span className="lw-t">
            Návrh na zápis zmeny konateľa
            <small>Alfa s.r.o.</small>
          </span>
          <span className="lw-ref">ORSR</span>
          <span className="lw-st warn">čaká na doklady</span>
        </div>
      </div>

      <div className="lw-note">
        <span>
          Brána (spec 0005): zdroj s locatorom · deterministický výpočet · <b>Potvrdiť / Upraviť / Odmietnuť / Odložiť</b> ·
          zápis do <b>spis.md</b> + ICS + audit. Originál návrhu sa neprepíše.
        </span>
      </div>
    </LawossLayout>
  );
}
