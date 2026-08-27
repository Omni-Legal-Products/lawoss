/** @jsxImportSource react */
import { Link } from "react-router-dom";

import { LawossLayout } from "../../shell/layout";

type RegistryRow = {
  name: string;
  sub: string;
  type: "MCP" | "skill";
  source: string;
  status: string;
  statusTone?: "warn";
};

const REGISTRY: RegistryRow[] = [
  { name: "Register úpadcov", sub: "konkurzy a reštrukturalizácie SR", type: "MCP", source: "Omni-Legal-Products · v1.2.0", status: "remote · local" },
  { name: "EUR-Lex", sub: "európske právo, CELEX", type: "MCP", source: "Omni-Legal-Products · v0.9.3", status: "remote" },
  { name: "subjektovy-research", sub: "light · medium · hard preverenie subjektu", type: "skill", source: "vyžaduje: ORSR · RPVS · úpadcovia", status: "v1.0" },
  { name: "lehoty-cz", sub: "počítanie lhůt podľa o.s.ř.", type: "skill", source: "vyžaduje: zakonyprolidi", status: "v0.3 · beta" },
  { name: "ISDS datová schránka", sub: "CZ · čítanie doručenek", type: "MCP", source: "komunita · neoverené", status: "mimo registry", statusTone: "warn" },
];

/**
 * Marketplace — fáza B mockup. Real catalogue comes from the `lawoss-registry`
 * repo (spec 0011 B) in fáza C7: pinned versions, remote/local install through a
 * deterministic skill/CLI, allowlist, rollback = pin revert.
 */
export function MarketplacePage() {
  return (
    <LawossLayout>
      <div className="lw-mockup">
        <b>NÁVRH</b>
        fiktívne dáta · fáza C7
      </div>
      <h1 className="lw-h1">Marketplace</h1>
      <p className="lw-lead">
        Konektory, skills a pluginy pre agenta — z overeného registra s pinnutými verziami. Systém upozorní na novú
        verziu, ale nikdy neaktualizuje sám.
      </p>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Katalóg</h2>
          <span className="lw-meta">
            lawoss-registry · pin = overená verzia
            <Link to="/konektory">Pripojené</Link>
          </span>
        </div>
        {REGISTRY.map((row) => (
          <div key={row.name} className="lw-row lw-cols-mkt">
            <span className="lw-no">—</span>
            <span className="lw-t">
              {row.name}
              <small>{row.sub}</small>
            </span>
            <span className="lw-ref">{row.type}</span>
            <span className="lw-ref">{row.source}</span>
            <span className={`lw-st ${row.statusTone ?? ""}`}>{row.status}</span>
            <span className="lw-go">
              {row.statusTone === "warn" ? "zobraziť" : <button className="lw-btn" type="button">Inštalovať</button>}
            </span>
          </div>
        ))}
      </div>

      <div className="lw-note">
        <span>
          Inštalácia je <b>deterministická</b> (skill/CLI) — model o nej nerozhoduje.
        </span>
        <span>
          Allowlist: iba repá z <b>lawoss-registry</b>.
        </span>
        <span>Rollback = vrátenie pinu.</span>
      </div>
    </LawossLayout>
  );
}
