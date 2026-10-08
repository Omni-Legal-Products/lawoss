/** Krok Priečinok (spec P1, P7): pripojiť existujúci priečinok alebo začať nanovo. */
import { useState } from "react";
import { FolderOpen, FolderPlus } from "lucide-react";
import type { OnboardingApi, OnboardingApplyResult } from "./api";
import { freshOfficeRequest, type FoundIdentity } from "./found-flow";
import type { FoundTextKey } from "./found-text";

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
          <button type="button" className="lw-btn" disabled={busy} onClick={onFresh}>{text("choose")}</button>
        </section>
      </div>
    </div>
  );
}

export function FreshDoneView({ text, onFinish }: { text: Text; onFinish: () => void }) {
  return (
    <div className="grid gap-3">
      <p>{text("freshDone")}</p>
      <p className="text-muted-foreground">{text("freshHowTo")}</p>
      <div><button type="button" className="lw-btn gold" onClick={onFinish}>{text("finish")}</button></div>
    </div>
  );
}

type Props = {
  api: Pick<OnboardingApi, "planOnboarding" | "applyOnboarding" | "updateOnboardingProfile">;
  identity: FoundIdentity;
  text: Text;
  pickDirectory: () => Promise<string | null>;
  onFound: (root: string) => void;
  onFreshDone: (result: OnboardingApplyResult) => void;
  onError: (reason: unknown) => void;
};

/**
 * „Začať nanovo“: vybraný (prázdny) priečinok dostane kanceláriu, `AGENTS.md` praxe a `Klienti/`.
 * Náhľad zmien netreba potvrdzovať zvlášť: do nového priečinka sa len pridáva (rovnaký zápis ako dnes Kancelária).
 */
export function FolderStep({ api, identity, text, pickDirectory, onFound, onFreshDone, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<OnboardingApplyResult | null>(null);
  const connect = async () => {
    const root = await pickDirectory();
    if (root) onFound(root);
  };
  const startFresh = async () => {
    const parent = await pickDirectory();
    if (!parent) return;
    setBusy(true);
    try {
      const preview = await api.planOnboarding(freshOfficeRequest(parent, identity));
      const result = await api.applyOnboarding({ id: preview.id, fingerprint: preview.fingerprint, confirm: true });
      await api.updateOnboardingProfile({ officeRoot: parent });
      setFresh(result);
    } catch (reason) {
      onError(reason);
    } finally {
      setBusy(false);
    }
  };
  if (fresh) return <FreshDoneView text={text} onFinish={() => onFreshDone(fresh)} />;
  return <FolderChoiceView text={text} busy={busy} onConnect={() => void connect()} onFresh={() => void startFresh()} />;
}
