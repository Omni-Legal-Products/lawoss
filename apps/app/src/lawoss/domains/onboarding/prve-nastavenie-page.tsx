/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useNavigate } from "react-router-dom";

import { resolveModelDisplayName, resolveProviderDisplayName } from "@/app/utils";
import { readStoredDefaultModel } from "@/react-app/kernel/model-config";
import { parseToolPermissions, readPermissionRecord } from "@/react-app/domains/settings/panels/tool-permissions-config";

import { LawossLayout } from "../../shell/layout";
import { loadOkfConnection } from "../../okf/connection";
import { DEFAULT_ONBOARDING_PROGRESS, readOnboardingProgress } from "./onboarding-state";
import {
  setupStatusLabel,
  buildSetupLedger,
  type SetupLedgerInput,
  type SetupLedgerStav,
} from "./setup-ledger";

const popisChyby = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Farba je len doplnok — znenie stavu nesie `SETUP_LEDGER_STAV_TEXT`. */
const STAV_TRIEDA: Record<SetupLedgerStav, string> = {
  pripravene: "ok",
  caka: "",
  volitelne: "off",
  chyba: "warn",
};

/** Čo vieme bez servera: uložený model a to, kde nastavenie skončilo. */
function lokalnyZaklad(): SetupLedgerInput {
  const ulozeny = readStoredDefaultModel();
  return {
    workspace: null,
    model: ulozeny
      ? {
          poskytovatel: resolveProviderDisplayName(ulozeny.providerID),
          model: resolveModelDisplayName(ulozeny.modelID),
        }
      : null,
    ochranaUprav: null,
    prvaUlohaHotova: false,
    postup: typeof window === "undefined" ? DEFAULT_ONBOARDING_PROGRESS : readOnboardingProgress(window.localStorage),
  };
}

/**
 * Prvé nastavenie — stavový register zo spec MF 3.1. Iba číta: workspace a
 * jeho cestu, uložený predvolený model, povolenie nástroja `edit` a to, či vo
 * workspace už existuje session. Zloženie riadkov robí čistá funkcia
 * `buildSetupLedger`.
 */
export function PrveNastaveniePage() {
  const locale = useLocale();
  const navigate = useNavigate();
  const [input, setInput] = useState<SetupLedgerInput | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const zaklad = lokalnyZaklad();
      let dalsi: SetupLedgerInput;
      try {
        const connection = await loadOkfConnection();
        const workspace = connection.workspaces.find((item) => item.id === connection.activeWorkspaceId) ?? null;
        dalsi = {
          ...zaklad,
          workspace: workspace ? { nazov: workspace.displayNameResolved, cesta: workspace.path } : null,
        };
        if (connection.client && workspace) {
          try {
            const config = await connection.client.getConfig(workspace.id);
            dalsi.ochranaUprav = parseToolPermissions(readPermissionRecord(config.opencode)).edit.action;
          } catch (error) {
            dalsi.ochranaChyba = popisChyby(error);
          }
          try {
            const sessions = await connection.client.listSessions(workspace.id, { limit: 1 });
            dalsi.prvaUlohaHotova = sessions.items.length > 0;
          } catch {
            // Zoznam sessions sa nedá prečítať — prvá úloha ostáva voliteľná.
          }
        }
      } catch (error) {
        dalsi = { ...zaklad, workspaceChyba: popisChyby(error) };
      }
      if (!cancelled) setInput(dalsi);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const riadky = input ? buildSetupLedger(input, locale) : [];
  const chybaPriecinka = input?.workspace === null;

  return (
    <LawossLayout>
      <h1 className="lw-h1">{t("lawoss.initial.title", locale)}</h1>
      <p className="lw-lead">{t("lawoss.initial.intro", locale)}</p>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>{t("lawoss.initial.title", locale)}</h2>
          <span className="lw-meta">{t("lawoss.initial.local_status", locale)}</span>
        </div>
        {input === null ? (
          <p className="lw-empty">{t("lawoss.initial.loading", locale)}</p>
        ) : (
          riadky.map((riadok) => (
            <div key={riadok.id} className="lw-row lw-cols-ledger">
              <span className="lw-no">{riadok.poradie}</span>
              <span className="lw-t">
                {riadok.nazov}
                <small>{riadok.detail}</small>
                {riadok.akcia ? <small className="lw-ledger-akcia">→ {riadok.akcia}</small> : null}
              </span>
              <span className={`lw-st ${STAV_TRIEDA[riadok.stav]}`}>
                {setupStatusLabel(riadok.stav, locale)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="lw-actions">
        <button className="lw-btn gold" type="button" onClick={() => navigate(chybaPriecinka ? "/welcome" : "/session")}>
          {t("lawoss.initial.continue", locale)}
        </button>
      </div>

      <div className="lw-note"><span>{t("lawoss.initial.local_note", locale)}</span><span>{t("lawoss.initial.readonly_note", locale)}</span></div>
    </LawossLayout>
  );
}
