/** @jsxImportSource react */
/**
 * Krok 3 „Toto sme našli“ (C1): náhľad stromu Kancelária → Klient → Prípad → Dokumenty so skutočnými menami
 * priečinkov a počtami, oprava typu, výber klientov praxe a jasne, čo pribudne (pomocné súbory) a že sa nič
 * nepresunie. Hlavná akcia len pridá pomocné súbory; usporiadanie podľa tabuľky je v Pokročilé.
 */
import { useId, type ReactNode } from "react";
import { Briefcase, Check, CircleAlert, FilePlus2, FileText, Landmark, ShieldCheck, UserRound } from "lucide-react";
import type { OnboardingSuggestion, SuggestedUnit } from "../api";
import { folderName, matterClientPath, type BatchItem } from "../found-flow";
import type { FoundTextKey } from "../found-text";
import { OkfNotice } from "../okf-notice";
import type { ConnectedClient, WizardConnected } from "../onboarding-state";
import { StepScreen } from "./wizard-frame";
import type { WizardText } from "./wizard-text";

type FoundText = (key: FoundTextKey, params?: Record<string, string | number>) => string;
export type WizardLevel = "practice" | "client" | "matter";
type Scope = "client" | "practice";

/** Prípady pod klientom praxe: pri malej praxi vypísané, pri veľkej len počet (strom ostane prehľadný). */
const MATTERS_SHOWN = 3;
const SMALL_PRACTICE = 6;
const ROOT_MATTERS_SHOWN = 8;

const unitOf = (suggestion: OnboardingSuggestion, path: string): SuggestedUnit | undefined => suggestion.units?.find((unit) => unit.path === path);

/** „3 prípady · aspoň 120 súborov“; bez údajov servera nič. */
function unitMeta(text: WizardText, unit: SuggestedUnit | undefined, withCases = true): string | undefined {
  if (!unit) return undefined;
  const files = text(unit.exact ? "treeFiles" : "treeFilesAtLeast", { count: unit.files });
  if (!withCases) return files;
  return `${unit.matterCount ? text("treeCases", { count: unit.matterCount }) : text("treeCasesNone")} · ${files}`;
}

function Node({ icon, kind, name, meta, badge, control, children }: {
  icon: ReactNode; kind: string; name: string; meta?: string; badge?: ReactNode; control?: ReactNode; children?: ReactNode;
}) {
  return (
    <li className="lw-wiz-tree-node">
      <div className="lw-wiz-tree-row">
        {control}
        <span className="lw-wiz-tree-icon" aria-hidden="true">{icon}</span>
        <span className="lw-wiz-tree-name">
          <span className="sr-only">{kind}: </span>{name}
          {meta ? <small>{meta}</small> : null}
        </span>
        {badge}
      </div>
      {children ? <ul>{children}</ul> : null}
    </li>
  );
}

function Matters({ text, unit, shown }: { text: WizardText; unit: SuggestedUnit | undefined; shown: number }) {
  if (!unit?.matterCount) return null;
  const rest = unit.matterCount - Math.min(shown, unit.matters.length);
  return (
    <>
      {unit.matters.slice(0, shown).map((matter) => (
        <Node key={matter.path} icon={<Briefcase className="size-4" />} kind={text("treeCase")} name={matter.name} />
      ))}
      {rest > 0 ? <li className="lw-wiz-tree-more">{text("treeMore", { count: rest })}</li> : null}
    </>
  );
}

const DocsLeaf = ({ text, meta }: { text: WizardText; meta?: string }) => (
  <Node icon={<FileText className="size-4" />} kind={text("exampleDocs")} name={text("treeDocsStay")} meta={meta} />
);

/** Stav klienta po pridaní súborov: ikona aj slovo. */
function AddedBadge({ text, item }: { text: WizardText; item: BatchItem | undefined }) {
  if (!item) return null;
  const done = item.status === "done";
  return (
    <span className="lw-wiz-badge" data-tone={done ? "ok" : "missing"}>
      {done ? <Check className="size-3.5" aria-hidden /> : <CircleAlert className="size-3.5" aria-hidden />}
      {text(done ? "treeAdded" : "treeNotAdded")}
    </span>
  );
}

/**
 * Strom náhľadu. Pri praxi „Každý klient zvlášť“ má každý klient zaškrtávacie pole (označenie je súčasťou stromu,
 * nie samostatného zoznamu). `added` ukáže stav po pridaní súborov.
 */
export function FoundTree({ text, suggestion, level, scope, selected, busy, onToggle, added }: {
  text: WizardText;
  suggestion: OnboardingSuggestion;
  level: WizardLevel;
  scope: Scope;
  selected: readonly string[];
  busy: boolean;
  onToggle?: (path: string) => void;
  added?: readonly BatchItem[];
}) {
  const root = unitOf(suggestion, "");
  const name = folderName(suggestion.root);
  let tree: ReactNode;
  if (level === "practice") {
    const pick = scope === "client" && onToggle !== undefined;
    tree = (
      <Node icon={<Landmark className="size-4" />} kind={text("treeOffice")} name={name} meta={text("readyClients", { count: suggestion.clients.length })}>
        {suggestion.clients.length ? suggestion.clients.map((client) => {
          const unit = unitOf(suggestion, client.path);
          const item = added?.find((entry) => entry.name === client.name);
          return (
            <Node
              key={client.path}
              icon={<UserRound className="size-4" />}
              kind={text("treeClient")}
              name={client.name}
              meta={unitMeta(text, unit)}
              badge={<AddedBadge text={text} item={item} />}
              control={pick ? (
                <input type="checkbox" aria-label={`${text("treeSelected")}: ${client.name}`} checked={selected.includes(client.path)} disabled={busy} onChange={() => onToggle?.(client.path)} />
              ) : undefined}
            >
              {unit?.matterCount && suggestion.clients.length <= SMALL_PRACTICE ? <Matters text={text} unit={unit} shown={MATTERS_SHOWN} /> : null}
            </Node>
          );
        }) : <li className="lw-wiz-tree-more">{text("treeNoClients")}</li>}
      </Node>
    );
  } else if (level === "matter") {
    tree = (
      <Node icon={<UserRound className="size-4" />} kind={text("treeClient")} name={folderName(matterClientPath(suggestion.root))}>
        <Node icon={<Briefcase className="size-4" />} kind={text("treeCase")} name={name}>
          <DocsLeaf text={text} meta={unitMeta(text, root, false)} />
        </Node>
      </Node>
    );
  } else {
    tree = (
      <Node icon={<UserRound className="size-4" />} kind={text("treeClient")} name={name} meta={unitMeta(text, root)} badge={<AddedBadge text={text} item={added?.[0]} />}>
        <Matters text={text} unit={root} shown={ROOT_MATTERS_SHOWN} />
        <DocsLeaf text={text} meta={unitMeta(text, root, false)} />
      </Node>
    );
  }
  return (
    <div className="lw-wiz-tree" data-lawoss-found-tree={level}>
      <ul aria-label={text("treeLabel")}>{tree}</ul>
    </div>
  );
}

/** Čo pribudne a čo ostane: pomocné súbory (zoznam zbalený) a vaše súbory na mieste. */
export function AddsPanel({ text, found }: { text: WizardText; found: FoundText }) {
  return (
    <section className="lw-wiz-adds" aria-label={text("foundAdds")}>
      <h3><FilePlus2 className="size-4" aria-hidden /> {text("foundAdds")}</h3>
      <OkfNotice text={found} />
      <p className="lw-wiz-keeps"><ShieldCheck className="size-4 shrink-0" aria-hidden /> {text("foundKeeps")}</p>
    </section>
  );
}

const LEVELS: readonly WizardLevel[] = ["client", "practice", "matter"];
const LEVEL_TEXT: Record<WizardLevel, FoundTextKey> = { client: "asClient", practice: "asPractice", matter: "asMatter" };
const SCOPES: readonly Scope[] = ["client", "practice"];

export type WizardFoundProps = {
  text: WizardText;
  found: FoundText;
  busy: boolean;
  /** Návrh tak, ako ho vidí zvolená úroveň (pri praxi kandidáti praxe). */
  suggestion: OnboardingSuggestion;
  headline: string;
  level: WizardLevel;
  scope: Scope;
  selected: readonly string[];
  nav?: ReactNode;
  onLevel: (level: WizardLevel) => void;
  onScope: (scope: Scope) => void;
  onToggle: (path: string) => void;
  onAll: (all: boolean) => void;
  onAdd: () => void;
  onTable: () => void;
  onPickRoot: (root: string) => void;
  childPath: (name: string) => string;
};

/** Otázka kroku „Toto sme našli“ v sprievodcovi: strom, oprava typu, čo pribudne a jedna hlavná akcia. */
export function WizardFoundView({ text, found, busy, suggestion, headline, level, scope, selected, nav, onLevel, onScope, onToggle, onAll, onAdd, onTable, onPickRoot, childPath }: WizardFoundProps) {
  const group = useId();
  const practiceEach = level === "practice" && scope === "client";
  const nothingSelected = practiceEach && selected.length === 0;
  const noClients = practiceEach && suggestion.clients.length === 0;
  const tableDisabled = level === "practice" && scope === "practice";
  const primary = level === "matter"
    ? found("useParent", { name: folderName(matterClientPath(suggestion.root)) })
    : practiceEach ? text("foundAddClients", { count: selected.length }) : text("foundAdd");
  return (
    <StepScreen step="found" title={text("foundTitle")} lead={<p>{headline}</p>} nav={nav}>
      {(suggestion.childOffices ?? []).map((name) => (
        <div key={name} className="lw-onb-inset grid gap-2">
          <p>{found("childOffice", { name })}</p>
          <div><button type="button" className="lw-btn" disabled={busy} onClick={() => onPickRoot(childPath(name))}>{found("pickChild", { name })}</button></div>
        </div>
      ))}
      {!suggestion.complete ? <p className="lw-status warn">{found("incomplete")}</p> : null}
      <fieldset className="lw-wiz-field">
        <legend className="lw-wiz-label">{text("foundType")}</legend>
        <div className="lw-wiz-chips">
          {LEVELS.map((value) => (
            <label key={value} className="lw-wiz-chip">
              <input type="radio" name={`${group}-level`} value={value} checked={level === value} disabled={busy} onChange={() => onLevel(value)} />
              <span>{found(LEVEL_TEXT[value])}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {level === "practice" ? (
        <fieldset className="lw-wiz-field">
          <legend className="lw-wiz-label">{found("scopeTitle")}</legend>
          <div className="lw-wiz-cards">
            {SCOPES.map((value) => (
              <label key={value} className="lw-wiz-card-option">
                <input type="radio" name={`${group}-scope`} checked={scope === value} disabled={busy} onChange={() => onScope(value)} />
                <span><strong>{found(value === "client" ? "scopeEach" : "scopeOne")}</strong><small>{found(value === "client" ? "scopeEachHint" : "scopeOneHint")}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {practiceEach && suggestion.clients.length ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="lw-btn" disabled={busy} onClick={() => onAll(true)}>{found("selectAll")}</button>
          <button type="button" className="lw-btn" disabled={busy} onClick={() => onAll(false)}>{found("selectNone")}</button>
        </div>
      ) : null}
      <FoundTree text={text} suggestion={suggestion} level={level} scope={scope} selected={selected} busy={busy} onToggle={onToggle} />
      {level === "matter" ? <p className="text-muted-foreground">{found("matterHint", { name: folderName(matterClientPath(suggestion.root)) })}</p> : null}
      {noClients ? <p className="lw-status warn">{found("noClientsHint")}</p> : null}
      <AddsPanel text={text} found={found} />
      <div className="lw-wiz-actions">
        <button type="button" className="lw-btn gold" disabled={busy || nothingSelected} onClick={onAdd}>{primary}</button>
        <p className="text-xs text-muted-foreground">{found("acknowledge")}</p>
      </div>
      {level !== "matter" ? (
        <details className="lw-wiz-details">
          <summary>{found("advanced")}</summary>
          <div className="lw-wiz-details-body grid gap-2">
            <p className="text-sm text-muted-foreground">{tableDisabled ? found("answerYesDisabled") : found(level === "practice" ? "answerYesPractice" : "answerYesHint")}</p>
            <div><button type="button" className="lw-btn" disabled={busy || tableDisabled || nothingSelected} onClick={onTable}>{text("foundTable")}</button></div>
          </div>
        </details>
      ) : null}
    </StepScreen>
  );
}

/** Už pripojené (návrat z ďalších krokov): strom so stavom a Pokračovať, bez opakovaného zápisu. */
export function WizardConnectedView({ text, busy, title, lead, tree, nav, onContinue }: {
  text: WizardText; busy: boolean; title: string; lead: string; tree: ReactNode; nav?: ReactNode; onContinue: () => void;
}) {
  return (
    <StepScreen step="found" title={title} lead={<p className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[var(--lw-success)]" aria-hidden />{lead}</p>} nav={nav}>
      {tree}
      <div className="lw-wiz-actions">
        <button type="button" className="lw-btn gold" disabled={busy} onClick={onContinue}>{text("continue")}</button>
      </div>
    </StepScreen>
  );
}

/** Strom už pripojeného priečinka (bez nového prezerania): klienti so stavom, celá prax alebo nová kancelária. */
export function ConnectedTree({ text, connected }: { text: WizardText; connected: WizardConnected }) {
  const name = folderName(connected.root);
  const added = (client: ConnectedClient): BatchItem => ({ root: client.root, name: client.name, status: "done", result: client.result });
  let tree: ReactNode;
  if (connected.kind === "fresh") {
    tree = (
      <Node icon={<Landmark className="size-4" />} kind={text("treeOffice")} name={name}>
        <Node icon={<UserRound className="size-4" />} kind={text("treeClient")} name={text("exampleClients")} meta={text("treeNoClients")} />
      </Node>
    );
  } else if (connected.kind === "practice") {
    tree = <Node icon={<Landmark className="size-4" />} kind={text("treeOffice")} name={name} meta={text("readyPractice")} badge={<AddedBadge text={text} item={{ root: connected.root, name, status: "done" }} />} />;
  } else if (connected.clients.length === 1 && connected.clients[0]) {
    const client = connected.clients[0];
    tree = <Node icon={<UserRound className="size-4" />} kind={text("treeClient")} name={client.name} badge={<AddedBadge text={text} item={added(client)} />}><DocsLeaf text={text} /></Node>;
  } else {
    tree = (
      <Node icon={<Landmark className="size-4" />} kind={text("treeOffice")} name={name} meta={text("readyClients", { count: connected.clients.length })}>
        {connected.clients.map((client) => (
          <Node key={client.root} icon={<UserRound className="size-4" />} kind={text("treeClient")} name={client.name} badge={<AddedBadge text={text} item={added(client)} />} />
        ))}
      </Node>
    );
  }
  return (
    <div className="lw-wiz-tree" data-lawoss-found-tree="connected">
      <ul aria-label={text("treeLabel")}>{tree}</ul>
    </div>
  );
}
