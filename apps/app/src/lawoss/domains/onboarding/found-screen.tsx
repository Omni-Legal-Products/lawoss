/**
 * „Toto som našiel“ (spec 2026-10-08): návrh úrovne, oprava, prax, otázka OKF, hromadné pridanie
 * a usporiadanie po jednom klientovi. Spoločná pre onboarding aj bočný panel („Pridať priečinok“).
 */
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/i18n/use-locale";
import { toggledLeave, triageApply, triageReplan, type TriageClient, type TriagePreview } from "../roztriedenie/api";
import { friendlyError, TriagePreviewView, useTriageText } from "../roztriedenie/triage-page";
import type { OnboardingApi, OnboardingApplyResult, OnboardingSuggestion } from "./api";
import { addOkfFiles, childPath, cloudFolderKind, connectPractice, firstWorkspaceResult, folderName, matterClientPath, createReorganizeFlow, retryFailed, workspaceResults, type BatchItem, type FoundIdentity } from "./found-flow";
import type { FoundTextKey } from "./found-text";
import { OkfNotice } from "./okf-notice";
import { ScreenHead } from "./folder-step";
import { onboardingErrorMessage } from "./onboarding-errors";
export { OkfNotice } from "./okf-notice";
import type { OnboardingCompletion } from "./lawoss-welcome-page";

type Text = (key: FoundTextKey, params?: Record<string, string | number>) => string;
export type FoundLevel = "practice" | "client" | "matter";
type Scope = "client" | "practice";
type Answer = "no" | "yes";

const SCOPES: readonly Scope[] = ["client", "practice"];

/**
 * Slabý návrh praxe: jediný signál sú podpriečinky pomenované ako veci. Rovnako vyzerá jeden klient
 * s datovanými verziami vecí, ktorý je podľa P4 typický. Appka sa preto pýta a predvolí klienta
 * (review VŘ k #135, bod 5: „pri jedinom signáli matter_named_children sa radšej opýtať“).
 */
export function isUncertainPractice(suggestion: OnboardingSuggestion): boolean {
  return suggestion.level === "practice" && !suggestion.marked && suggestion.signals.length === 1 && suggestion.signals[0] === "matter_named_children";
}

type ProposalKey = "practiceUncertain" | "practiceFound" | "clientFound" | "matterFound" | "unknownFound";

/**
 * Veta návrhu a predvolená voľba „Toto je“ z jedného rozhodnutia, aby si nemohli protirečiť
 * (MČ 19. 10. 2026). Slabá prax hovorí „Predvolený je klient“, preto predvolí klienta.
 */
export function foundProposal(suggestion: OnboardingSuggestion): { key: ProposalKey; level: FoundLevel } {
  if (isUncertainPractice(suggestion)) return { key: "practiceUncertain", level: "client" };
  if (suggestion.level === "practice") return { key: "practiceFound", level: "practice" };
  if (suggestion.level === "matter") return { key: "matterFound", level: "matter" };
  if (suggestion.level === "client") return { key: "clientFound", level: "client" };
  return { key: "unknownFound", level: "client" };
}

export const initialFoundLevel = (suggestion: OnboardingSuggestion): FoundLevel => foundProposal(suggestion).level;

const LEVEL_KEY: Record<FoundLevel, ProposalKey> = { client: "clientFound", practice: "practiceFound", matter: "matterFound" };

/**
 * Veta nad voľbou „Toto je“ nasleduje zvolenú úroveň (MČ 19. 10. 2026); návrh určuje len predvoľbu.
 * Kým advokát voľbu nezmení, ostáva veta návrhu (aj „Môže to byť jeden klient…“ či „Neviem s istotou…“).
 */
function headline(text: Text, suggestion: OnboardingSuggestion, level: FoundLevel): string {
  if (level === "practice" && suggestion.clients.length === 0) return text("practiceNoClients");
  const proposal = foundProposal(suggestion);
  return text(level === proposal.level ? proposal.key : LEVEL_KEY[level], { count: suggestion.clients.length, name: folderName(suggestion.root) });
}

/** Krok obrazovky: najprv zmaže starý pruh chyby, zlyhanie ohlási, `end` vždy (busy sa vráti). */
export async function runStep(work: () => Promise<void>, hooks: { start: () => void; fail: (reason: unknown) => void; end: () => void }): Promise<void> {
  hooks.start();
  try { await work(); } catch (reason) { hooks.fail(reason); } finally { hooks.end(); }
}

type ViewProps = {
  text: Text; busy: boolean; suggestion: OnboardingSuggestion; level: FoundLevel;
  scope: Scope; selected: readonly string[];
  onLevel: (level: FoundLevel) => void; onScope: (scope: Scope) => void;
  onToggle: (path: string) => void; onAll: (all: boolean) => void;
  onAnswer: (answer: Answer) => void; onChangeFolder: () => void;
  /** Kancelária v podpriečinku: pripojiť priamo ten podpriečinok. */
  onPickRoot: (root: string) => void;
};

export function FoundView({ text, busy, suggestion, level, scope, selected, onLevel, onScope, onToggle, onAll, onAnswer, onChangeFolder, onPickRoot }: ViewProps) {
  const yesDisabled = level === "practice" && scope === "practice";
  // Prax po klientoch bez označeného klienta: nie je čo urobiť, kancelária sa nezapíše.
  const nothingSelected = level === "practice" && scope === "client" && selected.length === 0;
  const parentName = folderName(matterClientPath(suggestion.root));
  const noClients = level === "practice" && scope === "client" && suggestion.clients.length === 0;
  const cloud = cloudFolderKind(suggestion.root);
  return (
    <div className="grid gap-5" data-lawoss-found>
      {/* Návrat na výber priečinka je pri nadpise: pod návrhom a odpoveďami by bol až po rolovaní (MČ 19. 10.). */}
      <ScreenHead title={text("foundTitle")}>
        <button type="button" className="lw-btn" disabled={busy} onClick={onChangeFolder}>{text("changeFolder")}</button>
      </ScreenHead>
      <p>{headline(text, suggestion, level)}</p>
      {(suggestion.childOffices ?? []).map((name) => (
        <div key={name} className="lw-onb-inset grid gap-2">
          <p>{text("childOffice", { name })}</p>
          <div><button type="button" className="lw-btn gold" disabled={busy} onClick={() => onPickRoot(childPath(suggestion.root, name))}>{text("pickChild", { name })}</button></div>
        </div>
      ))}
      {!suggestion.complete ? <p className="lw-status warn">{text("incomplete")}</p> : null}
      {/* Zápis do zdieľaného alebo cloudového priečinka uvidia aj iní; upozornenie raz, pred odpoveďami (MČ 19. 10.). */}
      {cloud ? <p className="lw-status warn">{text(cloud === "shared" ? "cloudShared" : "cloudSynced")}</p> : null}
      <label className="grid gap-1.5 text-sm font-medium">
        {text("correctLabel")}
        <select className="lw-onb-select" value={level} disabled={busy} onChange={(event) => { const value = event.target.value; if (value === "practice" || value === "client" || value === "matter") onLevel(value); }}>
          <option value="client">{text("asClient")}</option>
          <option value="practice">{text("asPractice")}</option>
          <option value="matter">{text("asMatter")}</option>
        </select>
      </label>
      {level === "matter" ? (
        <div className="lw-onb-inset grid gap-2">
          <p>{text("matterHint", { name: parentName })}</p>
          <OkfNotice text={text} />
          {/* R9: vec sa nepripája sama, pripojí sa nadradený klient s odpoveďou „Nie“. */}
          <div><button type="button" className="lw-btn gold" disabled={busy} onClick={() => onAnswer("no")}>{text("useParent", { name: parentName })}</button></div>
          <p className="text-xs text-muted-foreground">{text("acknowledge")}</p>
        </div>
      ) : null}
      {level === "practice" ? (
        <fieldset className="grid gap-2">
          <legend className="font-semibold">{text("scopeTitle")}</legend>
          {SCOPES.map((value) => (
            <label key={value} className="lw-onb-inset flex gap-3">
              <input type="radio" name="lawoss-scope" checked={scope === value} disabled={busy} onChange={() => onScope(value)} />
              <span><strong>{text(value === "client" ? "scopeEach" : "scopeOne")}</strong><br /><span className="text-muted-foreground">{text(value === "client" ? "scopeEachHint" : "scopeOneHint")}</span></span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {level === "practice" && scope === "client" && suggestion.clients.length ? (
        <fieldset className="grid gap-1">
          <legend className="font-semibold">{text("clientsTitle")}</legend>
          <div className="flex gap-2">
            <button type="button" className="lw-btn" disabled={busy} onClick={() => onAll(true)}>{text("selectAll")}</button>
            <button type="button" className="lw-btn" disabled={busy} onClick={() => onAll(false)}>{text("selectNone")}</button>
          </div>
          {suggestion.clients.map((client) => (
            <label key={client.path} className="flex gap-2"><input type="checkbox" checked={selected.includes(client.path)} disabled={busy} onChange={() => onToggle(client.path)} /><span>{client.name}</span></label>
          ))}
        </fieldset>
      ) : null}
      {level !== "matter" ? (
        <section className="grid gap-3">
          <h3 className="font-semibold">{text("reorganizeQuestion")}</h3>
          <OkfNotice text={text} />
          {noClients ? <p className="lw-status warn">{text("noClientsHint")}</p> : null}
          <div className="lw-onb-choices">
            <section className="lw-onb-choice">
              <h3>{text("answerNo")}</h3>
              <p>{text("answerNoHint")}</p>
              <button type="button" className="lw-btn gold" disabled={busy || nothingSelected} onClick={() => onAnswer("no")}>{text("answerNo")}</button>
            </section>
            <section className="lw-onb-choice">
              <h3>{text("answerYes")}</h3>
              <p>{yesDisabled ? text("answerYesDisabled") : text(level === "practice" ? "answerYesPractice" : "answerYesHint")}</p>
              <button type="button" className="lw-btn" disabled={busy || yesDisabled || nothingSelected} onClick={() => onAnswer("yes")}>{text("answerYes")}</button>
            </section>
          </div>
          <p className="text-xs text-muted-foreground">{text("acknowledge")}</p>
        </section>
      ) : null}
    </div>
  );
}

export function BatchView({ text, busy, items, answer, onRetry, onContinue, onChangeFolder }: { text: Text; busy: boolean; items: readonly BatchItem[]; answer?: Answer; onRetry: () => void; onContinue: () => void; onChangeFolder?: () => void }) {
  const done = items.filter(item => item.status === "done").length;
  const failed = items.filter(item => item.status === "failed");
  const pending = items.some(item => item.status === "pending");
  return (
    <div className="grid gap-3" data-lawoss-batch>
      <p role="status">{pending ? text("working", { done, total: items.length }) : text("batchDone", { done, total: items.length })}</p>
      {failed.map(item => <p key={item.root} className="lw-status err">{text("batchFailed", { name: item.name.replace(/\.$/, ""), error: item.error ?? "" })}</p>)}
      {!pending ? (
        <div className="flex gap-2">
          {failed.length ? <button type="button" className="lw-btn" disabled={busy} onClick={onRetry}>{text("retry")}</button> : null}
          {/* Nikto nepribudol: nie je čo otvoriť ani usporiadať, ostáva iný priečinok. */}
          {done === 0 && onChangeFolder
            ? <button type="button" className="lw-btn gold" disabled={busy} onClick={onChangeFolder}>{text("changeFolder")}</button>
            : <button type="button" className="lw-btn gold" disabled={busy} onClick={onContinue}>{text(answer === "yes" ? "nextClient" : "open")}</button>}
        </div>
      ) : null}
    </div>
  );
}

type ReorganizeProps = {
  text: Text; triageText: (key: string, params?: Record<string, string | number>) => string; busy: boolean;
  name: string; preview: TriagePreview; more: boolean;
  onKeep: (id: string, keep: boolean) => void; onLeave: (key: string, leave: boolean) => void; onConfirm: () => void; onSkip: () => void;
};

/**
 * Náhľad presunov jedného klienta (priečinok na mieste). Obal `lw-triage` nesie premenné a panely
 * roztriedenia; bez neho je tlačidlo potvrdenia v onboardingu takmer neviditeľné.
 */
export function ReorganizeView({ text, triageText, busy, name, preview, more, onKeep, onLeave, onConfirm, onSkip }: ReorganizeProps) {
  return (
    <div className="lw-triage lw-triage-embedded" data-lawoss-reorganize>
      <h2 className="text-xl font-semibold">{text("reorganizeFor", { name })}</h2>
      <TriagePreviewView preview={preview} text={triageText} busy={busy} inPlace onKeep={onKeep} onLeave={onLeave} onConfirm={onConfirm} onModel={() => undefined} />
      <div><button type="button" className="lw-btn" disabled={busy} onClick={onSkip}>{more ? text("skipClient") : text("finish")}</button></div>
    </div>
  );
}

/** Usporiadanie klienta sa nepodarilo; priečinok je už pripojený a vybraný, advokát môže skúsiť znova. */
export function ReorganizeFailedView({ text, busy, name, message, more, onRetry, onSkip }: { text: Text; busy: boolean; name: string; message: string; more: boolean; onRetry: () => void; onSkip: () => void }) {
  return (
    <div className="grid gap-3" data-lawoss-reorganize-failed>
      <ScreenHead title={text("reorganizeFor", { name })} />
      <p className="lw-status err" role="alert">{message}</p>
      <p className="text-muted-foreground">{text("reorganizeFailedHint")}</p>
      <div className="flex gap-2">
        <button type="button" className="lw-btn gold" disabled={busy} onClick={onRetry}>{text("retryReorganize")}</button>
        <button type="button" className="lw-btn" disabled={busy} onClick={onSkip}>{more ? text("skipClient") : text("finish")}</button>
      </div>
    </div>
  );
}

type Props = {
  api: Pick<OnboardingApi, "planOnboarding" | "applyOnboarding" | "updateOnboardingProfile" | "suggestOnboarding">;
  triage: TriageClient;
  identity: FoundIdentity;
  text: Text;
  root: string;
  onAcknowledge: () => Promise<void>;
  onDone: (result?: OnboardingApplyResult, completion?: OnboardingCompletion) => Promise<void> | void;
  /**
   * Zaregistruje a vyberie pripojený priečinok; volá sa pred usporiadaním (MČ 19. 10. 2026).
   * Môže vrátiť nového klienta servera (iný token či port po aktivácii), usporiadanie potom ide cez neho.
   */
  onRegister: (result?: OnboardingApplyResult, completion?: OnboardingCompletion) => Promise<TriageClient | undefined>;
  onChangeFolder: () => void;
  /** Iný koreň (kancelária v podpriečinku) bez nového dialógu výberu. */
  onPickRoot: (root: string) => void;
  onError: (reason: unknown) => void;
  /** Nový krok zmaže starý pruh chyby nad obrazovkou (review 6c). */
  onClearError: () => void;
};

type Phase =
  | { name: "loading"; failed?: boolean }
  | { name: "question"; suggestion: OnboardingSuggestion }
  | { name: "batch"; items: BatchItem[]; answer: Answer }
  | { name: "reorganize"; queue: BatchItem[]; preview: TriagePreview; result?: OnboardingApplyResult }
  | { name: "reorganizeFailed"; queue: BatchItem[]; message: string; result?: OnboardingApplyResult };

export function FoundScreen({ api, triage, identity, text, root, onAcknowledge, onDone, onRegister, onChangeFolder, onPickRoot, onError, onClearError }: Props) {
  const locale = useLocale();
  const triageText = useTriageText(locale);
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [level, setLevel] = useState<FoundLevel>("client");
  const [scope, setScope] = useState<Scope>("client");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Klienti dávky praxe: koniec toku (aj po usporiadaní po jednom) ich odovzdá všetkých, nie len prvého.
  const batchClients = useRef<OnboardingApplyResult[]>([]);
  // Klient roztriedenia; po registrácii ho môže nahradiť nový (review 6d).
  const triageClient = useRef<TriageClient>(triage);
  // Chyba klienta v dávke: veta v jazyku rozhrania ako vo vrchnom pruhu, surová správa do konzoly.
  const describe = (reason: unknown) => onboardingErrorMessage(reason, locale);
  const today = new Date();

  // Závislosti sú zámerne len [api, root]: onError od volajúceho je pri každom vykreslení nová
  // funkcia a návrh by sa inak volal stále dookola. Volajúci drží `api` stabilné.
  useEffect(() => {
    let cancelled = false;
    const suggest = api.suggestOnboarding;
    if (!suggest) { setPhase({ name: "loading", failed: true }); onError(new Error("suggest_unavailable")); return; }
    setPhase({ name: "loading" });
    onClearError();
    void suggest({ root }).then((suggestion) => {
      if (cancelled) return;
      setLevel(initialFoundLevel(suggestion));
      setSelected(suggestion.clients.map(client => client.path));
      setPhase({ name: "question", suggestion });
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setPhase({ name: "loading", failed: true });
      onError(reason);
    });
    return () => { cancelled = true; };
  }, [api, root]);

  const run = (work: () => Promise<void>) => runStep(work, { start: () => { onClearError(); setBusy(true); }, fail: onError, end: () => setBusy(false) });

  const completion = (): OnboardingCompletion | undefined => batchClients.current.length ? { clients: batchClients.current } : undefined;

  /**
   * Usporiadanie po pripojení: registrácia pred prvým klientom, zlyhaný náhľad ukáže vetu so Skúsiť znova
   * (klient sa potichu nepreskočí). Logika je v `createReorganizeFlow` (found-flow.ts).
   */
  const reorganize = createReorganizeFlow({
    client: triageClient,
    register: (result) => onRegister(result, completion()),
    done: (result) => onDone(result, completion()),
    show: (view) => setPhase(view.name === "reorganize" ? view : { name: "reorganizeFailed", queue: view.queue, result: view.result, message: friendlyError(view.failure, triageText) }),
  });

  const answer = (suggestion: OnboardingSuggestion, choice: Answer) => run(async () => {
    await onAcknowledge();
    if (level === "practice") {
      await connectPractice(api, suggestion.root, identity, suggestion, scope);
      if (scope === "practice") {
        // Celá prax ako jeden priečinok (P5): volajúci ju zaregistruje ako pracovný priečinok (bez výsledku klienta).
        await onDone(undefined, { workingFolder: suggestion.root });
        return;
      }
      const items = suggestion.clients.filter(client => selected.includes(client.path)).map(client => ({ root: childPath(suggestion.root, client.path), name: client.name }));
      const batch = await addOkfFiles(api, items, identity, today, (next) => setPhase({ name: "batch", items: next, answer: choice }), describe);
      setPhase({ name: "batch", items: batch, answer: choice });
      return;
    }
    // Vec (R9): pripojí sa nadradený priečinok ako klient, nie samotná vec.
    const target = level === "matter" ? matterClientPath(suggestion.root) : suggestion.root;
    const batch = await addOkfFiles(api, [{ root: target, name: folderName(target) }], identity, today, (next) => setPhase({ name: "batch", items: next, answer: choice }), describe);
    if (batch[0]?.status === "done" && choice === "no") { await onDone(batch[0].result); return; }
    if (batch[0]?.status === "done" && choice === "yes") { await reorganize.begin(batch, batch[0].result); return; }
    setPhase({ name: "batch", items: batch, answer: choice });
  });

  if (phase.name === "loading") {
    // Cesta späť na výber priečinka je aj počas prezerania (veľký priečinok môže trvať dlho), nielen po chybe.
    return (
      <div className="grid gap-3">
        <ScreenHead title={text("foundTitle")}>
          <button type="button" className="lw-btn" onClick={onChangeFolder}>{text("changeFolder")}</button>
        </ScreenHead>
        {phase.failed ? null : <p role="status">{text("looking")}</p>}
      </div>
    );
  }
  if (phase.name === "question") {
    return (
      <FoundView
        text={text} busy={busy} suggestion={phase.suggestion} level={level} scope={scope} selected={selected}
        onLevel={setLevel} onScope={setScope}
        onToggle={(path) => setSelected((current) => current.includes(path) ? current.filter(item => item !== path) : [...current, path])}
        onAll={(all) => setSelected(all ? phase.suggestion.clients.map(client => client.path) : [])}
        onAnswer={(choice) => void answer(phase.suggestion, choice)}
        onChangeFolder={onChangeFolder}
        onPickRoot={onPickRoot}
      />
    );
  }
  if (phase.name === "batch") {
    const continueBatch = () => run(async () => {
      const done = phase.items.filter(item => item.status === "done");
      batchClients.current = workspaceResults(phase.items);
      if (phase.answer === "yes") await reorganize.begin(done, firstWorkspaceResult(phase.items));
      else await onDone(firstWorkspaceResult(phase.items), { clients: batchClients.current });
    });
    const retry = () => run(async () => {
      const progress = (next: BatchItem[]) => setPhase({ name: "batch", items: next, answer: phase.answer });
      progress(await retryFailed(api, phase.items, identity, today, progress, describe));
    });
    return <BatchView text={text} busy={busy} items={phase.items} answer={phase.answer} onRetry={() => void retry()} onContinue={() => void continueBatch()} onChangeFolder={onChangeFolder} />;
  }
  const [current, ...rest] = phase.queue;
  if (phase.name === "reorganizeFailed") {
    return (
      <ReorganizeFailedView
        text={text} busy={busy} name={current?.name ?? ""} message={phase.message} more={rest.length > 0}
        onRetry={() => void run(() => reorganize.show(phase.queue, phase.result))}
        onSkip={() => void run(() => reorganize.show(rest, phase.result))}
      />
    );
  }
  return (
    <ReorganizeView
      text={text} triageText={triageText} busy={busy} name={current?.name ?? ""} preview={phase.preview} more={rest.length > 0}
      onKeep={(id, keep) => void run(async () => {
        const keepInInbox = keep ? [...phase.preview.keepInInbox, id] : phase.preview.keepInInbox.filter(item => item !== id);
        setPhase({ ...phase, preview: await triageReplan(triageClient.current, phase.preview.id, keepInInbox) });
      })}
      onLeave={(key, leave) => void run(async () => {
        setPhase({ ...phase, preview: await triageReplan(triageClient.current, phase.preview.id, phase.preview.keepInInbox, toggledLeave(phase.preview, key, leave)) });
      })}
      onConfirm={() => void run(async () => { await triageApply(triageClient.current, phase.preview); await reorganize.show(rest, phase.result); })}
      onSkip={() => void run(() => reorganize.show(rest, phase.result))}
    />
  );
}
