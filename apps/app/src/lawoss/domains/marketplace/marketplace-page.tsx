/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { LawossLayout } from "../../shell/layout";
import {
  MARKETPLACE_CATALOG,
  filterMarketplaceEntries,
  installationPreview,
  type MarketplaceChannel,
  type MarketplaceEntry,
  type MarketplaceFilters,
  type MarketplaceKind,
  type MarketplaceRisk,
  type MarketplaceVerificationStatus,
} from "./catalog";

const KIND_OPTIONS: ReadonlyArray<{ value: MarketplaceKind | "all"; label: string }> = [
  { value: "all", label: "Všetky typy" },
  { value: "mcp", label: "MCP" },
  { value: "skill", label: "Skills" },
  { value: "cli", label: "CLI" },
  { value: "workflow", label: "Workflow" },
];

const CHANNEL_OPTIONS: ReadonlyArray<{ value: MarketplaceChannel | "all"; label: string }> = [
  { value: "all", label: "Všetky kanály" },
  { value: "stable", label: "Stable" },
  { value: "lab", label: "Lab" },
  { value: "community", label: "Community" },
  { value: "private", label: "Private" },
];

const KIND_LABELS: Record<MarketplaceKind, string> = {
  mcp: "MCP",
  skill: "skill",
  cli: "CLI",
  workflow: "workflow bundle",
};

const CHANNEL_LABELS: Record<MarketplaceChannel, string> = {
  stable: "stable",
  lab: "lab",
  community: "community",
  private: "private",
};

const RISK_LABELS: Record<MarketplaceRisk, string> = {
  "read-only": "read-only",
  "local-write": "zápis lokálne",
  network: "sieť",
  "external-action": "externá akcia",
};

const VERIFICATION_LABELS: Record<MarketplaceVerificationStatus, string> = {
  verified: "overené",
  review: "v revízii",
  unverified: "neoverené",
};

function parseKind(value: string): MarketplaceKind | "all" {
  if (value === "all") return "all";
  return KIND_OPTIONS.some((option) => option.value === value) ? (value as MarketplaceKind) : "all";
}

function parseChannel(value: string): MarketplaceChannel | "all" {
  if (value === "all") return "all";
  return CHANNEL_OPTIONS.some((option) => option.value === value) ? (value as MarketplaceChannel) : "all";
}

function verificationClass(status: MarketplaceVerificationStatus): string {
  if (status === "verified") return "ok";
  if (status === "review") return "warn";
  return "off";
}

function CatalogRow(props: { entry: MarketplaceEntry; selected: boolean; onSelect: () => void }) {
  const { entry } = props;
  return (
    <button
      className={`lw-row lw-cols-mkt lw-marketplace-row ${props.selected ? "selected" : ""}`}
      type="button"
      aria-pressed={props.selected}
      onClick={props.onSelect}
    >
      <span className={`lw-no lw-marketplace-mark ${verificationClass(entry.verification.status)}`}>●</span>
      <span className="lw-t">
        {entry.name}
        <small>{entry.description}</small>
      </span>
      <span className="lw-ref">{KIND_LABELS[entry.kind]}</span>
      <span className="lw-ref">
        {CHANNEL_LABELS[entry.channel]} · {entry.jurisdictions.join(" · ")}
      </span>
      <span className={`lw-st ${verificationClass(entry.verification.status)}`}>
        {VERIFICATION_LABELS[entry.verification.status]}
      </span>
      <span className="lw-go">detail</span>
    </button>
  );
}

function EntryDetail(props: { entry: MarketplaceEntry }) {
  const preview = installationPreview(props.entry);

  return (
    <section className="lw-marketplace-detail" aria-labelledby="marketplace-entry-title">
      <div className="lw-marketplace-detail-heading">
        <div>
          <span className="lw-sc">Vybraná schopnosť</span>
          <h2 id="marketplace-entry-title">{props.entry.name}</h2>
          <p>{props.entry.description}</p>
        </div>
        <span className={`lw-st ${verificationClass(props.entry.verification.status)}`}>
          {VERIFICATION_LABELS[props.entry.verification.status]}
        </span>
      </div>

      <dl className="lw-marketplace-facts">
        <div>
          <dt>Typ</dt>
          <dd>{KIND_LABELS[props.entry.kind]}</dd>
        </div>
        <div>
          <dt>Kanál</dt>
          <dd>{CHANNEL_LABELS[props.entry.channel]}</dd>
        </div>
        <div>
          <dt>Jurisdikcia</dt>
          <dd>{props.entry.jurisdictions.join(" · ")}</dd>
        </div>
        <div>
          <dt>Overené</dt>
          <dd>{props.entry.verification.checkedAt}</dd>
        </div>
        <div className="wide">
          <dt>Zdroj</dt>
          <dd className="lw-mono">
            {props.entry.source.repository}@{props.entry.source.ref}
          </dd>
        </div>
        <div className="wide">
          <dt>Závislosti</dt>
          <dd>{props.entry.dependencies.length ? props.entry.dependencies.join(" · ") : "žiadne"}</dd>
        </div>
      </dl>

      <div className="lw-marketplace-risk">
        <span className="lw-sc">Čo táto schopnosť môže robiť</span>
        <div className="lw-marketplace-tags">
          {props.entry.capabilities.map((capability) => (
            <span key={capability} className={`lw-marketplace-tag ${capability === "external-action" ? "danger" : ""}`}>
              {RISK_LABELS[capability]}
            </span>
          ))}
        </div>
      </div>

      <div className="lw-marketplace-preview" data-preview-status="preview-only">
        <div className="lw-marketplace-preview-heading">
          <div>
            <span className="lw-sc">Plán inštalácie</span>
            <h3>Iba náhľad</h3>
          </div>
          <span className="lw-marketplace-preview-status">{preview.status}</span>
        </div>
        <p>
          <b>Iba náhľad — nič sa neinštaluje.</b> Budúci installer môže použiť tento pinned zdroj až po explicitnom
          potvrdení človekom.
        </p>
        <ul>
          <li>Rozsah: {preview.scope}</li>
          <li>Zdroj: {preview.source}</li>
          <li>Ľudská brána: {preview.humanGate}</li>
        </ul>
      </div>
    </section>
  );
}

export function MarketplacePage() {
  const [filters, setFilters] = useState<MarketplaceFilters>({ kind: "all", channel: "all" });
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(MARKETPLACE_CATALOG[0]?.id ?? null);
  const entries = useMemo(() => filterMarketplaceEntries(MARKETPLACE_CATALOG, filters), [filters]);
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? entries[0] ?? null;

  return (
    <LawossLayout>
      <h1 className="lw-h1">Marketplace</h1>
      <p className="lw-lead">
        Schopnosti pre agenta z lokálneho katalógu. Pred použitím vidíte zdroj, závislosti, oprávnenia a potrebné
        potvrdenie človekom.
      </p>

      <div className="lw-reg lw-marketplace">
        <div className="lw-reg-h">
          <h2>Katalóg</h2>
          <span className="lw-meta">
            {entries.length} položiek
            <Link to="/konektory">Pripojené</Link>
          </span>
        </div>

        <div className="lw-marketplace-filters" aria-label="Filtrovanie katalógu">
          <label>
            Typ
            <select
              value={filters.kind ?? "all"}
              onChange={(event) => setFilters((current) => ({ ...current, kind: parseKind(event.currentTarget.value) }))}
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kanál
            <select
              value={filters.channel ?? "all"}
              onChange={(event) => setFilters((current) => ({ ...current, channel: parseChannel(event.currentTarget.value) }))}
            >
              {CHANNEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <span className="lw-marketplace-filter-note">Kliknutím zobrazíte detail a plán.</span>
        </div>

        {entries.length ? (
          entries.map((entry) => (
            <CatalogRow
              key={entry.id}
              entry={entry}
              selected={entry.id === selectedEntry?.id}
              onSelect={() => setSelectedEntryId(entry.id)}
            />
          ))
        ) : (
          <p className="lw-empty">Pre túto kombináciu filtrov nie je v lokálnom katalógu žiadna položka.</p>
        )}
      </div>

      {selectedEntry ? <EntryDetail entry={selectedEntry} /> : null}

      <div className="lw-note">
        <span>
          Katalóg je <b>lokálny a deterministický</b>; zobrazenie položky ju nepripojí ani nenainštaluje.
        </span>
        <span>
          Budúci GitHub registry dodá pinned manifest po <b>validácii</b>.
        </span>
        <span>
          Externé akcie ostávajú za <b>ľudskou bránou</b>.
        </span>
      </div>
    </LawossLayout>
  );
}
