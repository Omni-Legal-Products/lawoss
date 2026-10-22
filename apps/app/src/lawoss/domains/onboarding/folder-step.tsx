/** Krok Priečinok (spec P1, P7): pripojiť existujúci priečinok alebo začať nanovo. */
import { useRef, useState, type ReactNode } from "react";
import { FolderOpen, FolderPlus } from "lucide-react";
import { AlphaNoticeInline } from "../../alpha/alpha-notice";
import type { OnboardingApi, OnboardingApplyResult } from "./api";
import { freshFolderFlow, startFreshFolder, type FoundIdentity } from "./found-flow";
import type { FoundTextKey } from "./found-text";
import { OkfNotice } from "./okf-notice";
import { FRESH_NOT_EMPTY } from "./onboarding-errors";
import { DocumentsChoiceView } from "./wizard/documents-step";
import type { WizardText } from "./wizard/wizard-text";

type Text = (key: FoundTextKey, params?: Record<string, string | number>) => string;

/**
 * Nadpis obrazovky s vedľajšou navigáciou (Späť, Zrušiť, Vybrať iný priečinok) vpravo. Veľké voľby pod ním
 * sú vysoké; navigácia v päte by bola dosiahnuteľná až po rolovaní (MČ 19. 10. 2026).
 */
export function ScreenHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </div>
  );
}

export function FolderChoiceView({ text, busy, onConnect, onFresh, nav }: { text: Text; busy: boolean; onConnect: () => void; onFresh: () => void; nav?: ReactNode }) {
  return (
    <div className="grid gap-4">
      <ScreenHead title={text("folderTitle")}>{nav}</ScreenHead>
      <p className="text-muted-foreground">{text("folderLead")}</p>
      {/* Alfa: pri voľbe priečinka musí byť vidieť, na čom sa skúša; tu bez možnosti skryť. */}
      <AlphaNoticeInline />
      <div className="lw-onb-choices">
        <section className="lw-onb-choice">
          <FolderOpen className="size-6" aria-hidden />
          <h3>{text("connectExisting")}</h3>
          <p>{text("connectExistingHint")}</p>
          <button type="button" className="lw-btn gold" disabled={busy} onClick={onConnect}>{text("choose")}</button>
        </section>
        <section className="lw-onb-choice">
          <FolderPlus className="size-6" aria-hidden />
          <h3>{text("startFresh")}</h3>
          <p>{text("startFreshHint")}</p>
          {/* R3: nový priečinok dostane súbory OKF, oznámenie musí byť pri voľbe viditeľné. */}
          <OkfNotice text={text} />
          <button type="button" className="lw-btn" disabled={busy} onClick={onFresh}>{text("choose")}</button>
          <p className="text-xs text-muted-foreground">{text("acknowledge")}</p>
        </section>
      </div>
    </div>
  );
}

export function FreshDoneView({ text, busy = false, onFinish, nav }: { text: Text; busy?: boolean; onFinish: () => void; nav?: ReactNode }) {
  return (
    <div className="grid gap-3">
      {nav ? <ScreenHead title={text("folderTitle")}>{nav}</ScreenHead> : null}
      <p>{text("freshDone")}</p>
      <p className="text-muted-foreground">{text("freshHowTo")}</p>
      <div><button type="button" className="lw-btn gold" disabled={busy} onClick={onFinish}>{text("finish")}</button></div>
    </div>
  );
}

/** „Začať nanovo“ do zdieľaného alebo cloudového priečinka: upozornenie pred zápisom (review 6d). */
export function FreshCloudNoticeView({ text, kind, onContinue, onCancel }: { text: Text; kind: "shared" | "cloud"; onContinue: () => void; onCancel: () => void }) {
  return (
    <div className="grid gap-3" data-lawoss-fresh-cloud>
      <ScreenHead title={text("startFresh")} />
      <p className="lw-status warn">{text(kind === "shared" ? "cloudShared" : "cloudSynced")}</p>
      <div className="flex gap-2">
        <button type="button" className="lw-btn gold" onClick={onContinue}>{text("proceed")}</button>
        <button type="button" className="lw-btn" onClick={onCancel}>{text("cancel")}</button>
      </div>
    </div>
  );
}

/**
 * Jedna akcia kroku Priečinok (pripojiť alebo začať nanovo): najprv zmaže starý pruh chyby, potom pracuje
 * (N-4, 22. 10. 2026: „Vyberte prázdny priečinok“ ostávala vedľa úspešne založenej kancelárie).
 * `not_empty` sa ohlási vetou kroku, `null` (nič nevybrané, zrušené) nerobí nič.
 */
export async function folderAction<R>(deps: { clear: () => void; work: () => Promise<R | "not_empty" | null>; report: (reason: unknown) => void; done: (result: R) => void }): Promise<void> {
  deps.clear();
  try {
    const result = await deps.work();
    if (result === "not_empty") deps.report(new Error(FRESH_NOT_EMPTY));
    else if (result !== null) deps.done(result);
  } catch (reason) {
    deps.report(reason);
  }
}

type Props = {
  api: Pick<OnboardingApi, "planOnboarding" | "applyOnboarding" | "updateOnboardingProfile" | "suggestOnboarding">;
  identity: FoundIdentity;
  text: Text;
  pickDirectory: () => Promise<string | null>;
  onFound: (root: string) => void;
  /** Vzatie oznámenia OKF na vedomie (zapíše sa len raz za verziu oznámenia). */
  onAcknowledge: () => Promise<void>;
  onFreshDone: (result: OnboardingApplyResult) => Promise<void> | void;
  onError: (reason: unknown) => void;
  /** Nová akcia zmaže starý pruh chyby nad obrazovkou (N-4). */
  onClearError: () => void;
  /** Späť alebo Zrušiť od volajúceho, zobrazené pri nadpise. */
  nav?: ReactNode;
  /**
   * Sprievodca po krokoch (C1): obrazovka „Vaše dokumenty“ s príkladmi výsledku; „Začať nanovo“ po zápise
   * rovno pokračuje (súhrn ukáže krok „Toto sme našli“). `resume` ponúkne naposledy vybraný priečinok.
   */
  wizard?: { text: WizardText; resume?: { name: string; onContinue: () => void } };
};

/** „Začať nanovo“: prázdny vybraný priečinok dostane kanceláriu, `AGENTS.md` praxe a `Klienti/`. */
export function FolderStep({ api, identity, text, pickDirectory, onFound, onAcknowledge, onFreshDone, onError, onClearError, nav, wizard }: Props) {
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<OnboardingApplyResult | null>(null);
  // Otázka pred zápisom do zdieľaného alebo cloudového priečinka; odpoveď dokončí čakajúci `confirm`.
  const [cloudAsk, setCloudAsk] = useState<{ kind: "shared" | "cloud"; answer: (proceed: boolean) => void } | null>(null);
  // Dvojklik na „Dokončiť“ nesmie dokončiť onboarding dvakrát; ref platí ešte pred novým vykreslením.
  const finishing = useRef(false);
  const connect = () => folderAction({ clear: onClearError, work: pickDirectory, report: onError, done: onFound });
  const startFresh = async () => {
    setBusy(true);
    try {
      await folderAction({
        clear: onClearError,
        work: () => freshFolderFlow({
          pick: pickDirectory,
          confirm: (kind) => new Promise<boolean>((resolve) => setCloudAsk({ kind, answer: (proceed) => { setCloudAsk(null); resolve(proceed); } })),
          start: (parent) => startFreshFolder(api, parent, identity, onAcknowledge),
        }),
        report: onError,
        done: wizard ? (result) => void finish(result) : setFresh,
      });
    } finally {
      setBusy(false);
    }
  };
  const finish = async (result: OnboardingApplyResult) => {
    if (finishing.current) return;
    finishing.current = true;
    setBusy(true);
    try {
      await onFreshDone(result);
    } finally {
      finishing.current = false;
      setBusy(false);
    }
  };
  if (cloudAsk) return <FreshCloudNoticeView text={text} kind={cloudAsk.kind} onContinue={() => cloudAsk.answer(true)} onCancel={() => cloudAsk.answer(false)} />;
  if (fresh) return <FreshDoneView text={text} busy={busy} onFinish={() => void finish(fresh)} nav={nav} />;
  if (wizard) return <DocumentsChoiceView text={wizard.text} found={text} busy={busy} nav={nav} resume={wizard.resume} onConnect={() => void connect()} onFresh={() => void startFresh()} />;
  return <FolderChoiceView text={text} busy={busy} onConnect={() => void connect()} onFresh={() => void startFresh()} nav={nav} />;
}
