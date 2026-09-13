/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { resolveModelDisplayName, resolveProviderDisplayName } from "@/app/utils";
import { readStoredDefaultModel } from "@/react-app/kernel/model-config";
import { parseToolPermissions, readPermissionRecord } from "@/react-app/domains/settings/panels/tool-permissions-config";

import { LawossLayout } from "../../shell/layout";
import { loadOkfConnection } from "../../okf/connection";
import { DEFAULT_ONBOARDING_PROGRESS, readOnboardingProgress } from "./onboarding-state";
import {
  SETUP_LEDGER_STAV_TEXT,
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

  const riadky = input ? buildSetupLedger(input) : [];
  const chybaPriecinka = input?.workspace === null;

  return (
    <LawossLayout>
      <h1 className="lw-h1">Prvé nastavenie</h1>
      <p className="lw-lead">
        Čo už vzniklo, čo ešte chýba a kam sa ukladajú súbory. Register je iba na čítanie a otvoríte ho aj neskôr;
        keď nastavenie prerušíte, pokračuje sa od posledného kroku.
      </p>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Prvé nastavenie</h2>
          <span className="lw-meta">stav sa číta z tohto počítača</span>
        </div>
        {input === null ? (
          <p className="lw-empty">Čítame stav nastavenia…</p>
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
                {SETUP_LEDGER_STAV_TEXT[riadok.stav]}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="lw-actions">
        <button className="lw-btn gold" type="button" onClick={() => navigate(chybaPriecinka ? "/welcome" : "/session")}>
          Pokračovať
        </button>
      </div>

      <div className="lw-note">
        <span>
          Všetko beží <b>lokálne</b>; dokumenty idú iba k modelu, ktorý si vyberiete.
        </span>
        <span>Register nič nenastavuje — opravy sa robia tam, kam odkazuje riadok.</span>
      </div>
    </LawossLayout>
  );
}
