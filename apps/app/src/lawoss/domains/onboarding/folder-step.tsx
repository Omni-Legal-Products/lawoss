/** Krok Priečinok (spec P1, P7): pripojiť existujúci priečinok alebo začať nanovo. */
import { useRef, useState } from "react";
import { FolderOpen, FolderPlus } from "lucide-react";
import type { OnboardingApi, OnboardingApplyResult } from "./api";
import { startFreshFolder, type FoundIdentity } from "./found-flow";
import type { FoundTextKey } from "./found-text";
import { OkfNotice } from "./okf-notice";

type Text = (key: FoundTextKey, params?: Record<string, string | number>) => string;

export function FolderChoiceView({ text, busy, onConnect, onFresh }: { text: Text; busy: boolean; onConnect: () => void; onFresh: () => void }) {
  return (
    <div className="grid gap-4">
      <h2 className="text-xl font-semibold">{text("folderTitle")}</h2>
      <p className="text-muted-foreground">{text("folderLead")}</p>
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

export function FreshDoneView({ text, busy = false, onFinish }: { text: Text; busy?: boolean; onFinish: () => void }) {
  return (
    <div className="grid gap-3">
      <p>{text("freshDone")}</p>
      <p className="text-muted-foreground">{text("freshHowTo")}</p>
      <div><button type="button" className="lw-btn gold" disabled={busy} onClick={onFinish}>{text("finish")}</button></div>
    </div>
  );
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
};

/** „Začať nanovo“: prázdny vybraný priečinok dostane kanceláriu, `AGENTS.md` praxe a `Klienti/`. */
export function FolderStep({ api, identity, text, pickDirectory, onFound, onAcknowledge, onFreshDone, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<OnboardingApplyResult | null>(null);
  // Dvojklik na „Dokončiť“ nesmie dokončiť onboarding dvakrát; ref platí ešte pred novým vykreslením.
  const finishing = useRef(false);
  const connect = async () => {
    try {
      const root = await pickDirectory();
      if (root) onFound(root);
    } catch (reason) {
      onError(reason);
    }
  };
  const startFresh = async () => {
    setBusy(true);
    try {
      const parent = await pickDirectory();
      if (!parent) return;
      const result = await startFreshFolder(api, parent, identity, onAcknowledge);
      if (result === "not_empty") onError(new Error(text("freshNotEmpty")));
      else setFresh(result);
    } catch (reason) {
      onError(reason);
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
  if (fresh) return <FreshDoneView text={text} busy={busy} onFinish={() => void finish(fresh)} />;
  return <FolderChoiceView text={text} busy={busy} onConnect={() => void connect()} onFresh={() => void startFresh()} />;
}
