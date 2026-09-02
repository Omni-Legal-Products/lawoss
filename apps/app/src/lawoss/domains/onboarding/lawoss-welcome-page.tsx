/** @jsxImportSource react */
import { Page, PageTitlebarRegion } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollAreaViewport } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";

import lawossMark from "../../../../../../lawoss/brand/lawoss-mark.svg";
import { LawossWordmark } from "../../shell/wordmark";
import "../../shell/lawoss.css";

/**
 * LAWOSS welcome screen — a holding version of MF's approved Fáza 1 design
 * (`docs/superpowers/specs/2026-08-28-lawoss-one-click-onboarding-design.md`
 * in the coordination repo). It carries the design's copy and the four things
 * onboarding sets up, in LAWOSS colours, and says out loud that the real flow
 * is still MF's to build.
 *
 * Deliberately NOT implemented here: the recommended-setup fast path, the
 * per-screen model/add-on steps and resumable state. Those are Fáza 1 proper.
 * The one real action below — pick a folder — is the upstream behaviour,
 * untouched, so onboarding still works.
 */

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
  busy,
  error,
  analyticsEnabled,
  onAnalyticsChange,
}: LawossWelcomePageProps) {
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
                  <Button size="lg" className="w-full" onClick={onGetStarted} disabled={busy}>
                    {/* Slovak throughout: the rest of this screen is not translated
                        either, so the upstream `getStartedLabel` would mix languages. */}
                    {busy ? "Vytvárame pracovné miesto…" : "Vybrať priečinok a začať"}
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
                  <b>Rozpracované — dokončí Martin Friedrich</b>
                  <p>
                    Toto je dočasná obrazovka. Schválený návrh „one-click onboarding, Fáza 1“ leží v koordinačnom repe
                    ako <span className="lw-mono">docs/superpowers/specs/2026-08-28-lawoss-one-click-onboarding-design.md</span>.
                  </p>
                  <p>
                    Chýba rýchla cesta <b>Použiť odporúčané nastavenie</b>, obrazovky pre AI model a doplnky, a
                    pokračovanie od posledného nedokončeného kroku. Martin, je to tvoje. 🙂
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
