/**
 * „Toto som našiel“ (spec 2026-10-08): návrh úrovne, oprava, prax, otázka OKF, hromadné pridanie
 * a usporiadanie po jednom klientovi. Spoločná pre onboarding aj bočný panel („Pridať priečinok“).
 */
import { useEffect, useState } from "react";
import { useLocale } from "@/i18n/use-locale";
import { triageApply, triageReplan, type TriageClient, type TriagePreview } from "../roztriedenie/api";
import { TriagePreviewView, useTriageText } from "../roztriedenie/triage-page";
import type { OnboardingApi, OnboardingApplyResult, OnboardingSuggestion } from "./api";
import { addOkfFiles, childPath, connectPractice, firstWorkspaceResult, folderName, matterClientPath, reorganizeTarget, retryFailed, startReorganize, type BatchItem, type FoundIdentity } from "./found-flow";
import type { FoundTextKey } from "./found-text";
import type { OnboardingCompletion } from "./lawoss-welcome-page";

type Text = (key: FoundTextKey, params?: Record<string, string | number>) => string;
export type FoundLevel = "practice" | "client" | "matter";
type Scope = "client" | "practice";
type Answer = "no" | "yes";

const OKF_FILES = ["AGENTS.md", "CLAUDE.md", "client.md", "memory/", "_STATUS.md"];
const SCOPES: readonly Scope[] = ["client", "practice"];

function headline(text: Text, suggestion: OnboardingSuggestion): string {
  if (suggestion.level === "practice") return text("practiceFound", { count: suggestion.clients.length });
  if (suggestion.level === "client") return text("clientFound", { name: folderName(suggestion.root) });
  if (suggestion.level === "matter") return text("matterFound", { name: folderName(suggestion.root) });
  return text("unknownFound");
}

/** Oznámenie OKF so zoznamom súborov (R3); musí byť viditeľné pri každej odpovedi, ktorá ho potvrdzuje. */
function OkfNotice({ text }: { text: Text }) {
  return (
    <>
      <p className="text-muted-foreground">{text("okfNotice")}</p>
      <p className="text-sm"><strong>{text("filesTitle")}:</strong> {OKF_FILES.join(", ")}</p>
    </>
  );
}

type ViewProps = {
  text: Text; busy: boolean; suggestion: OnboardingSuggestion; level: FoundLevel;
  scope: Scope; selected: readonly string[];
  onLevel: (level: FoundLevel) => void; onScope: (scope: Scope) => void;
  onToggle: (path: string) => void; onAll: (all: boolean) => void;
  onAnswer: (answer: Answer) => void; onChangeFolder: () => void;
};

export function FoundView({ text, busy, suggestion, level, scope, selected, onLevel, onScope, onToggle, onAll, onAnswer, onChangeFolder }: ViewProps) {
  const yesDisabled = level === "practice" && scope === "practice";
  // Prax po klientoch bez označeného klienta: nie je čo urobiť, kancelária sa nezapíše.
  const nothingSelected = level === "practice" && scope === "client" && selected.length === 0;
  const parentName = folderName(matterClientPath(suggestion.root));
  return (
    <div className="grid gap-5" data-lawoss-found>
      <h2 className="text-xl font-semibold">{text("foundTitle")}</h2>
      <p>{headline(text, suggestion)}</p>
      {!suggestion.complete ? <p className="lw-status warn">{text("incomplete")}</p> : null}
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
      <div><button type="button" className="lw-btn" disabled={busy} onClick={onChangeFolder}>{text("changeFolder")}</button></div>
    </div>
  );
}

export function BatchView({ text, busy, items, answer, onRetry, onContinue }: { text: Text; busy: boolean; items: readonly BatchItem[]; answer?: Answer; onRetry: () => void; onContinue: () => void }) {
  const done = items.filter(item => item.status === "done").length;
  const failed = items.filter(item => item.status === "failed");
  const pending = items.some(item => item.status === "pending");
  return (
    <div className="grid gap-3" data-lawoss-batch>
      <p role="status">{pending ? text("working", { done, total: items.length }) : text("batchDone", { done, total: items.length })}</p>
      {failed.map(item => <p key={item.root} className="lw-status err">{text("batchFailed", { name: item.name, error: item.error ?? "" })}</p>)}
      {!pending ? (
        <div className="flex gap-2">
          {failed.length ? <button type="button" className="lw-btn" disabled={busy} onClick={onRetry}>{text("retry")}</button> : null}
          <button type="button" className="lw-btn gold" disabled={busy} onClick={onContinue}>{text(answer === "yes" ? "nextClient" : "open")}</button>
        </div>
      ) : null}
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
  onChangeFolder: () => void;
  onError: (reason: unknown) => void;
};

type Phase =
  | { name: "loading"; failed?: boolean }
  | { name: "question"; suggestion: OnboardingSuggestion }
  | { name: "batch"; items: BatchItem[]; answer: Answer }
  | { name: "reorganize"; queue: BatchItem[]; preview: TriagePreview; result?: OnboardingApplyResult };

export function FoundScreen({ api, triage, identity, text, root, onAcknowledge, onDone, onChangeFolder, onError }: Props) {
  const locale = useLocale();
  const triageText = useTriageText(locale);
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [level, setLevel] = useState<FoundLevel>("client");
  const [scope, setScope] = useState<Scope>("client");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const today = new Date();

  // Závislosti sú zámerne len [api, root]: onError od volajúceho je pri každom vykreslení nová
  // funkcia a návrh by sa inak volal stále dookola. Volajúci drží `api` stabilné.
  useEffect(() => {
    let cancelled = false;
    const suggest = api.suggestOnboarding;
    if (!suggest) { setPhase({ name: "loading", failed: true }); onError(new Error("suggest_unavailable")); return; }
    setPhase({ name: "loading" });
    void suggest({ root }).then((suggestion) => {
      if (cancelled) return;
      setLevel(suggestion.level === "practice" || suggestion.level === "matter" ? suggestion.level : "client");
      setSelected(suggestion.clients.map(client => client.path));
      setPhase({ name: "question", suggestion });
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setPhase({ name: "loading", failed: true });
      onError(reason);
    });
    return () => { cancelled = true; };
  }, [api, root]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } catch (reason) { onError(reason); } finally { setBusy(false); }
  };

  /**
   * Ďalší klient vo fronte usporiadania, alebo koniec toku. Ak sa náhľad klienta nepodarí
   * (napr. odmietnutý súhlas), chyba sa ohlási a klient sa preskočí; inak by na obrazovke
   * ostal už potvrdený náhľad predchádzajúceho klienta.
   */
  const nextReorganize = async (queue: readonly BatchItem[], result?: OnboardingApplyResult): Promise<void> => {
    const [current, ...rest] = queue;
    if (!current) { await onDone(result); return; }
    let preview: TriagePreview;
    try {
      preview = await startReorganize(triage, reorganizeTarget(current));
    } catch (reason) {
      onError(reason);
      await nextReorganize(rest, result);
      return;
    }
    setPhase({ name: "reorganize", queue: [current, ...rest], preview, result });
  };

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
      const batch = await addOkfFiles(api, items, identity, today, (next) => setPhase({ name: "batch", items: next, answer: choice }));
      setPhase({ name: "batch", items: batch, answer: choice });
      return;
    }
    // Vec (R9): pripojí sa nadradený priečinok ako klient, nie samotná vec.
    const target = level === "matter" ? matterClientPath(suggestion.root) : suggestion.root;
    const batch = await addOkfFiles(api, [{ root: target, name: folderName(target) }], identity, today, (next) => setPhase({ name: "batch", items: next, answer: choice }));
    if (batch[0]?.status === "done" && choice === "no") { await onDone(batch[0].result); return; }
    if (batch[0]?.status === "done" && choice === "yes") { await nextReorganize(batch, batch[0].result); return; }
    setPhase({ name: "batch", items: batch, answer: choice });
  });

  if (phase.name === "loading") {
    // Po chybe návrhu ostane cesta späť na výber priečinka; chybu hlási onError.
    return (
      <div className="grid gap-3">
        <p role="status">{text("looking")}</p>
        {phase.failed ? <div><button type="button" className="lw-btn" onClick={onChangeFolder}>{text("changeFolder")}</button></div> : null}
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
      />
    );
  }
  if (phase.name === "batch") {
    const continueBatch = () => run(async () => {
      const done = phase.items.filter(item => item.status === "done");
      if (phase.answer === "yes") await nextReorganize(done, firstWorkspaceResult(phase.items));
      else await onDone(firstWorkspaceResult(phase.items));
    });
    const retry = () => run(async () => {
      const progress = (next: BatchItem[]) => setPhase({ name: "batch", items: next, answer: phase.answer });
      progress(await retryFailed(api, phase.items, identity, today, progress));
    });
    return <BatchView text={text} busy={busy} items={phase.items} answer={phase.answer} onRetry={() => void retry()} onContinue={() => void continueBatch()} />;
  }
  const [current, ...rest] = phase.queue;
  return (
    <div className="grid gap-3" data-lawoss-reorganize>
      <h2 className="text-xl font-semibold">{text("reorganizeFor", { name: current?.name ?? "" })}</h2>
      <TriagePreviewView
        preview={phase.preview} text={triageText} busy={busy}
        onKeep={(id, keep) => void run(async () => {
          const keepInInbox = keep ? [...phase.preview.keepInInbox, id] : phase.preview.keepInInbox.filter(item => item !== id);
          setPhase({ ...phase, preview: await triageReplan(triage, phase.preview.id, keepInInbox) });
        })}
        onConfirm={() => void run(async () => { await triageApply(triage, phase.preview); await nextReorganize(rest, phase.result); })}
        onModel={() => undefined}
      />
      <div><button type="button" className="lw-btn" disabled={busy} onClick={() => void run(() => nextReorganize(rest, phase.result))}>{rest.length ? text("skipClient") : text("finish")}</button></div>
    </div>
  );
}
