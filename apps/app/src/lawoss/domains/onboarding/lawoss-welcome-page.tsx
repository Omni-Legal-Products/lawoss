/** @jsxImportSource react */
import { Page, PageTitlebarRegion } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollAreaViewport } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";

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
const NASTAVIME = [
  { title: "Pracovné dokumenty", desc: "Priečinok, s ktorým bude LAWOSS pracovať. Pred úpravou alebo odstránením súboru si vypýta potvrdenie." },
  { title: "AI model", desc: "Vyberiete si ho vy. Dokumenty môžu ísť iba k modelu, ktorý zvolíte." },
  { title: "Ochrana pri úpravách", desc: "Zmenu, uloženie aj odstránenie súboru vždy potvrdzuje človek." },
  { title: "Office a hlasová transkripcia", desc: "Voliteľné doplnky. Nikdy neblokujú prvé použitie." },
];

/** First-task suggestions from the design's "Prvá úloha" section. */
const PRVA_ULOHA = ["Zhrnúť dokument", "Skontrolovať zmluvu", "Porovnať dva dokumenty"];

type LawossWelcomePageProps = {
  onGetStarted: () => void;
  getStartedLabel?: string;
  busy?: boolean;
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
  error,
  analyticsEnabled,
  onAnalyticsChange,
}: LawossWelcomePageProps) {
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
                  <span className="lw-sc lw-welcome-eyebrow">Advokátska prax · Slovensko a Česko</span>
                  <h1 className="lw-h1 lw-welcome-h1">Pripravme LAWOSS na vašu prácu</h1>
                  <p className="lw-lead">
                    Nastavíme pracovný priečinok, AI model a základné doplnky. Väčšinu nastavení môžete neskôr zmeniť.
                  </p>

                  <div className="lw-welcome-lanes" role="group" aria-label="Spôsob nastavenia">
                    <button
                      type="button"
                      className={`lw-welcome-lane ${!detailed ? "active" : ""}`}
                      aria-pressed={!detailed}
                      onClick={() => chooseLane("recommended")}
                    >
                      <span className="lw-welcome-lane-title">Odporúčané nastavenie</span>
                      <span className="lw-welcome-lane-desc">Bezpečné predvolené hodnoty, pripravené na prvú úlohu.</span>
                    </button>
                    <button
                      type="button"
                      className={`lw-welcome-lane ${detailed ? "active" : ""}`}
                      aria-pressed={detailed}
                      onClick={() => chooseLane("detailed")}
                    >
                      <span className="lw-welcome-lane-title">Nastaviť podrobne</span>
                      <span className="lw-welcome-lane-desc">Najprv zvoľte priečinok a upravte voľby podľa svojej praxe.</span>
                    </button>
                  </div>
                </div>

                <div className="lw-welcome-steps">
                  {NASTAVIME.map((item, index) => (
                    <div key={item.title} className={`lw-welcome-step ${index > 0 ? "sep" : ""}`}>
                      <span className="lw-welcome-no">{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <div className="lw-welcome-step-t">{item.title}</div>
                        <div className="lw-welcome-step-d">{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="lw-welcome-actions">
                  {detailed && showManualFolder ? (
                    <div className="lw-welcome-manual">
                      <label htmlFor="lw-manual-folder">Cesta k pracovnému priečinku</label>
                      <div className="lw-welcome-manual-row">
                        <input
                          id="lw-manual-folder"
                          value={manualFolder}
                          onChange={(event) => onManualFolderChange?.(event.currentTarget.value)}
                          placeholder="/Users/…/Spisy"
                          autoComplete="off"
                        />
                        <Button variant="outline" onClick={useManualFolder} disabled={busy || !manualFolder.trim()}>
                          Použiť cestu
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <Button size="lg" className="w-full" onClick={continueOnboarding} disabled={busy}>
                    {busy ? "Vytvárame pracovné miesto…" : detailed ? "Vybrať priečinok a pokračovať" : "Použiť odporúčané nastavenie"}
                  </Button>
                  {error ? <p className="lw-welcome-err">{error}</p> : null}
                  <p className="lw-welcome-fine">
                    Beží na tomto počítači. Dokumenty sa zdieľajú iba s modelom, ktorý si vyberiete.
                  </p>

                  <div className="lw-welcome-analytics">
                    <div>
                      <div className="lw-welcome-step-t">Pomôžte nám aplikáciu zlepšovať</div>
                      <p className="lw-welcome-step-d">
                        Anonymné údaje o používaní — ktoré funkcie používate, chyby a výkon. Nikdy nie vaše dokumenty,
                        prompty ani obsah spisov. Kedykoľvek zmeníte v Nastaveniach.
                      </p>
                    </div>
                    <Switch
                      aria-label="Zdieľať anonymné údaje o používaní"
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
                  <span className="lw-sc lw-welcome-eyebrow">Prvá úloha</span>
                  <h2 className="lw-welcome-h2">Otvorte priečinok a povedzte, čo treba.</h2>
                </div>

                <div className="lw-welcome-tasks">
                  {PRVA_ULOHA.map((task) => (
                    <div key={task} className="lw-welcome-task">
                      <span className="lw-welcome-dot" />
                      {task}
                    </div>
                  ))}
                </div>

                <div className="lw-welcome-todo">
                  <b>Čo bude nasledovať</b>
                  <p>
                    Najprv vytvoríme pracovné miesto bez úprav vašich dokumentov. Potom pripojíte AI model a môžete
                    voliteľne zapnúť Office alebo hlasovú transkripciu.
                  </p>
                  <p>
                    Ak onboarding prerušíte, zvolený spôsob nastavenia a posledný krok zostanú uložené v tomto počítači.
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
