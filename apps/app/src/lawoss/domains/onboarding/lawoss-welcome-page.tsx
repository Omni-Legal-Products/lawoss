/** @jsxImportSource react */
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { LanguageSwitcher } from "../../shell/language-switcher";
import type { SetupTextKey } from "../../i18n/setup";
import { Page, PageTitlebarRegion } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollAreaViewport } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import { Link } from "react-router-dom";

import lawossMark from "../../../../../../lawoss/brand/lawoss-mark.svg";
import { LawossWordmark } from "../../shell/wordmark";
import "../../shell/lawoss.css";
import {
  DEFAULT_ONBOARDING_PROGRESS,
  readOnboardingProgress,
  writeOnboardingProgress,
  type OnboardingLane,
  type OnboardingProgress,
} from "./onboarding-state";

/** What onboarding sets up, per the design's "Obrazovka 1: Začnime". */
const NASTAVIME: ReadonlyArray<{ title: SetupTextKey; desc: SetupTextKey }> = [
  { title: "welcome.documents", desc: "welcome.documentsDesc" },
  { title: "welcome.model", desc: "welcome.modelDesc" },
  { title: "welcome.safeguards", desc: "welcome.safeguardsDesc" },
  { title: "welcome.extras", desc: "welcome.extrasDesc" },
];
const PRVA_ULOHA: readonly SetupTextKey[] = ["welcome.summarize", "welcome.review", "welcome.compare"];

type LawossWelcomePageProps = {
  onGetStarted: () => void;
  getStartedLabel?: string;
  busy?: boolean;
  busyPhase?: "workspace" | "session" | "engine" | null;
  error?: string | null;
  manualFolder?: string;
  onManualFolderChange?: (value: string) => void;
  onUseManualFolder?: () => void;
  showManualFolder?: boolean;
  analyticsEnabled: boolean;
  onAnalyticsChange: (enabled: boolean) => void;
};

export function LawossWelcomePage({
  onGetStarted,
  manualFolder = "",
  onManualFolderChange,
  onUseManualFolder,
  showManualFolder = false,
  busy,
  busyPhase,
  error,
  analyticsEnabled,
  onAnalyticsChange,
}: LawossWelcomePageProps) {
  const locale = useLocale();
  const text = (key: SetupTextKey): string => t(`lawoss.setup.${key}`, locale);
  const [progress, setProgress] = useState<OnboardingProgress>(() => {
    if (typeof window === "undefined") return DEFAULT_ONBOARDING_PROGRESS;
    return readOnboardingProgress(window.localStorage);
  });
  const detailed = progress.lane === "detailed";

  const remember = (next: OnboardingProgress) => {
    setProgress(next);
    if (typeof window !== "undefined") writeOnboardingProgress(window.localStorage, next);
  };

  const chooseLane = (lane: OnboardingLane) => {
    remember({ lane, step: progress.step === "folder" ? "folder" : "welcome" });
  };

  const continueOnboarding = () => {
    remember({ ...progress, step: "folder" });
    onGetStarted();
  };

  const useManualFolder = () => {
    if (!onUseManualFolder) return;
    remember({ ...progress, step: "folder" });
    onUseManualFolder();
  };

  return (
    <Page className="min-h-screen bg-background">
      <PageTitlebarRegion />

      <ScrollArea className="relative z-10">
        <ScrollAreaViewport>
          <div className="lw-welcome">
            <div className="lw-welcome-entry">
              <div className="lw-welcome-col">
                <div>
                  <div className="lw-welcome-brand">
                    <img src={lawossMark} alt="" />
                    <div>
                      <LawossWordmark className="lw-welcome-wordmark" />
                      <small>CZECHIA SLOVAKIA AND BEYOND</small>
                    </div>
                  </div>
                  <div className="mb-5 flex justify-end"><LanguageSwitcher /></div>
                  <span className="lw-sc lw-welcome-eyebrow">{text("welcome.practice")}</span>
                  <h1 className="lw-h1 lw-welcome-h1">{text("welcome.title")}</h1>
                  <p className="lw-lead">
                    {text("welcome.intro")}
                  </p>

                  <div className="lw-welcome-lanes" role="group" aria-label={text("welcome.setupMethod")}>
                    <button
                      type="button"
                      className={`lw-welcome-lane ${!detailed ? "active" : ""}`}
                      aria-pressed={!detailed}
                      onClick={() => chooseLane("recommended")}
                    >
                      <span className="lw-welcome-lane-title">{text("welcome.recommended")}</span>
                      <span className="lw-welcome-lane-desc">{text("welcome.recommendedDesc")}</span>
                    </button>
                    <button
                      type="button"
                      className={`lw-welcome-lane ${detailed ? "active" : ""}`}
                      aria-pressed={detailed}
                      onClick={() => chooseLane("detailed")}
                    >
                      <span className="lw-welcome-lane-title">{text("welcome.detailed")}</span>
                      <span className="lw-welcome-lane-desc">{text("welcome.detailedDesc")}</span>
                    </button>
                  </div>
                </div>

                <div className="lw-welcome-steps">
                  {NASTAVIME.map((item, index) => (
                    <div key={item.title} className={`lw-welcome-step ${index > 0 ? "sep" : ""}`}>
                      <span className="lw-welcome-no">{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <div className="lw-welcome-step-t">{text(item.title)}</div>
                        <div className="lw-welcome-step-d">{text(item.desc)}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="lw-welcome-actions">
                  {detailed && showManualFolder ? (
                    <div className="lw-welcome-manual">
                      <label htmlFor="lw-manual-folder">{text("welcome.folderPath")}</label>
                      <div className="lw-welcome-manual-row">
                        <input
                          id="lw-manual-folder"
                          value={manualFolder}
                          onChange={(event) => onManualFolderChange?.(event.currentTarget.value)}
                          placeholder="/Users/…/Spisy"
                          autoComplete="off"
                        />
                        <Button variant="outline" onClick={useManualFolder} disabled={busy || !manualFolder.trim()}>
                          {text("welcome.usePath")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <Button size="lg" className="w-full" onClick={continueOnboarding} disabled={busy}>
                    {busy ? busyPhase === "engine" ? text("welcome.startingEngine") : busyPhase === "session" ? text("welcome.preparingTask") : text("welcome.creatingWorkspace") : detailed ? text("welcome.pickAndContinue") : text("welcome.useRecommended")}
                  </Button>
                  {error ? <p className="lw-welcome-err">{error}</p> : null}
                  <p className="lw-welcome-fine">
                    {text("welcome.localNote")}
                  </p>

                  <div className="lw-welcome-analytics">
                    <div>
                      <div className="lw-welcome-step-t">{text("welcome.improve")}</div>
                      <p className="lw-welcome-step-d">
                        {text("welcome.analyticsDesc")}
                      </p>
                    </div>
                    <Switch
                      aria-label={text("welcome.analyticsLabel")}
                      checked={analyticsEnabled}
                      onCheckedChange={onAnalyticsChange}
                      className="data-checked:bg-foreground data-checked:border-transparent"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="lw-welcome-panel-wrap">
              <div className="lw-welcome-panel">
                <div>
                  <span className="lw-sc lw-welcome-eyebrow">{text("welcome.firstTask")}</span>
                  <h2 className="lw-welcome-h2">{text("welcome.taskTitle")}</h2>
                </div>

                <div className="lw-welcome-tasks">
                  {PRVA_ULOHA.map((task) => (
                    <div key={task} className="lw-welcome-task">
                      <span className="lw-welcome-dot" />
                      {text(task)}
                    </div>
                  ))}
                </div>

                <div className="lw-welcome-todo">
                  <b>{text("welcome.next")}</b>
                  <p>
                    {text("welcome.nextDesc")}
                  </p>
                  <p>
                    {text("welcome.resume")}
                  </p>
                  <p>
                    {text("welcome.ledgerBefore")}{" "}
                    <Link to="/experimenty/prve-nastavenie">{text("welcome.ledger")}</Link>. {text("welcome.ledgerAfter")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </ScrollAreaViewport>
      </ScrollArea>
    </Page>
  );
}
