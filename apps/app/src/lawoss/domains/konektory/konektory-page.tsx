/** @jsxImportSource react */
import { Link } from "react-router-dom";

import { LawossLayout } from "../../shell/layout";

type ConnectorRow = {
  no: string;
  name: string;
  sub: string;
  trust: "loc" | "own" | "ext";
  trustLabel: string;
  ref: string;
  status: string;
  statusTone: "ok" | "warn" | "off";
  action: string;
};

const CONNECTORS: ConnectorRow[] = [
  { no: "1.", name: "Slov-Lex", sub: "zbierka zákonov SR · mcp-slovlex", trust: "own", trustLabel: "vlastný server · remote", ref: "9 nástrojov · read-only", status: "pripojené", statusTone: "ok", action: "nástroje · logy" },
  { no: "2.", name: "Judikatúra SR", sub: "NS SR · ÚS SR · MS SR · 161 229 rozhodnutí", trust: "own", trustLabel: "vlastný server · remote", ref: "24 nástrojov · read-only", status: "pripojené", statusTone: "ok", action: "nástroje · logy" },
  { no: "3.", name: "ORSR · RPO · RPVS", sub: "registre SR · 3 servery", trust: "own", trustLabel: "vlastný server · remote", ref: "18 nástrojov · read-only", status: "pripojené", statusTone: "ok", action: "nástroje · logy" },
  { no: "4.", name: "OKF skripty", sub: "okf-validate · okf-freshness · vlastné", trust: "loc", trustLabel: "lokálne", ref: "3 skripty · posledný beh OK", status: "pripravené", statusTone: "ok", action: "spustiť" },
  { no: "5.", name: "Whisper transkripcia", sub: "sherpa-onnx · model medium-sk", trust: "loc", trustLabel: "lokálne", ref: "GPU áno", status: "pripravené", statusTone: "ok", action: "modely" },
  { no: "6.", name: "OCR", sub: "tesseract 5 · sk · cs · en", trust: "loc", trustLabel: "lokálne", ref: "—", status: "pripravené", statusTone: "ok", action: "nastavenia" },
  { no: "7.", name: "Autogram", sub: "KEP + časová pečiatka · zaručená konverzia · externý proces", trust: "loc", trustLabel: "lokálne", ref: "mac · win", status: "nenájdený", statusTone: "warn", action: "nastaviť cestu →" },
  { no: "8.", name: "Context7", sub: "dokumentácia knižníc", trust: "ext", trustLabel: "tretia strana · dáta odchádzajú", ref: "2 nástroje", status: "vypnuté v spisoch", statusTone: "off", action: "zapnúť" },
];

/**
 * Konektory — fáza B mockup. Real state comes from `connections/store` (MCP)
 * plus `lawoss/hub` local-tool detection in fáza C6; the schema shows what the
 * agent can reach and, deliberately, what it cannot (no send/sign tool).
 */
export function KonektoryPage() {
  return (
    <LawossLayout>
      <h1 className="lw-h1">Konektory</h1>
      <p className="lw-lead">
        Čo agent vidí a čo smie použiť. Registre sú iba na čítanie; lokálne nástroje bežia vo vašom počítači; servery
        tretích strán sú vždy označené.
      </p>

      <div className="lw-schema">
        <Schema />
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Pripojené</h2>
          <span className="lw-meta">
            stav k 04:10
            <a href="#byo">Pridať vlastný server</a>
            <Link to="/marketplace">Marketplace</Link>
          </span>
        </div>
        {CONNECTORS.map((row) => (
          <div key={row.no} className="lw-row lw-cols-con">
            <span className="lw-no">{row.no}</span>
            <span className="lw-t">
              {row.name}
              <small>{row.sub}</small>
            </span>
            <span className={`lw-trust ${row.trust}`}>{row.trustLabel}</span>
            <span className="lw-ref">{row.ref}</span>
            <span className={`lw-st ${row.statusTone}`}>{row.status}</span>
            <span className="lw-go">{row.action}</span>
          </div>
        ))}
      </div>

      <div className="lw-note">
        <span>
          Agent <b>nemá</b> nástroj na odoslanie ani podpis (ADR 0007 pravidlo 5).
        </span>
        <span>
          Vlastný server (BYO): remote URL alebo lokálny príkaz — zapisuje sa priamo do opencode configu.
        </span>
      </div>
    </LawossLayout>
  );
}

function Schema() {
  return (
    <svg viewBox="0 0 1160 230" aria-label="Schéma: LAWOSS → opencode → konektory" fontSize="12">
      <g fill="var(--lw-text-primary)">
        <rect x="20" y="70" width="200" height="90" rx="3" fill="var(--lw-hover)" stroke="var(--lw-border-strong)" />
        <text x="36" y="96" fontWeight="600">LAWOSS</text>
        <text x="36" y="116" fill="var(--lw-text-secondary)">chat · spisy · lehoty</text>
        <text x="36" y="134" fill="var(--lw-text-secondary)">dokumenty · nastavenia</text>
        <text x="36" y="152" fill="var(--lw-text-tertiary)" fontSize="11">povrch pre advokáta</text>

        <line x1="220" x2="300" y1="115" y2="115" stroke="var(--lw-accent)" />
        <path d="M294 110l8 5-8 5z" fill="var(--lw-accent)" />

        <rect x="300" y="50" width="240" height="130" rx="3" fill="var(--lw-accent-soft)" stroke="var(--lw-accent)" />
        <text x="316" y="76" fontWeight="600">opencode · agent</text>
        <text x="316" y="98" fill="var(--lw-text-secondary)">subagenti · tool calling · súbory</text>
        <text x="316" y="120" fill="var(--lw-text-secondary)">skills · prompty · pamäť OKF</text>
        <text x="316" y="166" fill="var(--lw-text-tertiary)" fontSize="11">žiadny nástroj na odoslanie ani podpis</text>

        <g stroke="var(--lw-border-strong)" fill="none">
          <path d="M540 115 C600 115 600 30 660 30" />
          <path d="M540 115 C600 115 600 72 660 72" />
          <path d="M540 115 C600 115 600 115 660 115" stroke="var(--lw-accent)" />
          <path d="M540 115 C600 115 600 158 660 158" />
          <path d="M540 115 C600 115 600 200 660 200" strokeDasharray="3 3" />
        </g>

        <circle cx="668" cy="30" r="4" fill="var(--lw-success)" />
        <text x="682" y="34">Slov-Lex · Judikatúra SR</text>
        <text x="920" y="34" fill="var(--lw-text-tertiary)" fontSize="11">remote · read-only · 33 nástrojov</text>
        <circle cx="668" cy="72" r="4" fill="var(--lw-success)" />
        <text x="682" y="76">ORSR · RPVS · FS · úpadcovia</text>
        <text x="920" y="76" fill="var(--lw-text-tertiary)" fontSize="11">remote · read-only · 18 nástrojov</text>
        <circle cx="668" cy="115" r="4" fill="var(--lw-success)" />
        <text x="682" y="119">OKF skripty · OCR · Whisper</text>
        <text x="920" y="119" fill="var(--lw-text-tertiary)" fontSize="11">lokálne · výstup do spisu</text>
        <circle cx="668" cy="158" r="4" fill="var(--lw-warning)" />
        <text x="682" y="162">Autogram</text>
        <text x="920" y="162" fill="var(--lw-warning)" fontSize="11">lokálne · nenájdený</text>
        <circle cx="668" cy="200" r="4" fill="none" stroke="var(--lw-text-tertiary)" />
        <text x="682" y="204" fill="var(--lw-text-secondary)">Vlastný server (BYO)</text>
        <text x="920" y="204" fill="var(--lw-text-tertiary)" fontSize="11">remote URL alebo lokálny príkaz</text>
      </g>
    </svg>
  );
}
