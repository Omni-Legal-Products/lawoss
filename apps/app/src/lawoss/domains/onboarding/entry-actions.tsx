/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { FolderInput, FolderPlus, FolderTree, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/i18n/use-locale";
import { createLegalworkServerClient } from "@/app/lib/legalwork-server";
import { resolveLegalworkConnection } from "@/react-app/shell/legalwork-connection";
import { isLawossHomeWorkspace } from "../../home-workspace";
import { ADD_FOLDER_PATH, NEW_MATTER_PATH, organizeFolderLink } from "../../lite/links";
import { activeWorkspace, useOkfConnection } from "../../okf/read-model";
import type { OkfChoice } from "./api";

/** Pôvodné „Zapnúť OKF“ vedie na krok Priečinok (OKF je súčasťou pripojenia priečinka). */
export const ENABLE_OKF_ROUTE = ADD_FOLDER_PATH;

/** Offer OKF until it is on; an unreadable status still offers it (the link only opens the choice). */
export function offersOkf(status: { profile: { okf?: OkfChoice } | null } | null): boolean {
  return status?.profile?.okf?.enabled !== true;
}

/** Koľkokrát a ako často čítať stav, kým server pri štarte ešte nemá adresu. */
const STATUS_ATTEMPTS = 8;
const STATUS_RETRY_MS = 750;

/**
 * Voľba OKF zo stavu onboardingu. `known` je true len pri skutočne prečítanom stave: pri štarte
 * appky ešte spojenie nemá adresu servera a prvé čítania zlyhajú (D1 2026-10-04), preto sa skúša
 * znova. Až keď zlyhajú všetky pokusy, `offered` platí ako pri neznámom stave (`offersOkf(null)`).
 */
export function useOkfChoice(skip: boolean): { offered: boolean | undefined; known: boolean } {
  const [choice, setChoice] = useState<{ offered: boolean | undefined; known: boolean }>({ offered: undefined, known: false });
  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (left: number) => {
      void resolveLegalworkConnection()
        .then(({ normalizedBaseUrl, resolvedToken, resolvedHostToken }) => {
          if (!normalizedBaseUrl) throw new Error("server address not ready");
          return createLegalworkServerClient({
            baseUrl: normalizedBaseUrl,
            token: resolvedToken || undefined,
            hostToken: resolvedHostToken || undefined,
          }).onboardingStatus();
        })
        .then((status) => { if (!cancelled) setChoice({ offered: offersOkf(status), known: true }); })
        .catch(() => {
          if (cancelled) return;
          if (left > 1) timer = setTimeout(() => attempt(left - 1), STATUS_RETRY_MS);
          else setChoice({ offered: offersOkf(null), known: false });
        });
    };
    attempt(STATUS_ATTEMPTS);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [skip]);
  return choice;
}

/** `undefined` while the onboarding status is loading. */
export function useOkfOffered(skip: boolean): boolean | undefined {
  return useOkfChoice(skip).offered;
}

const labels = {
  en: { client: "Add client", folder: "Add folder", organize: "Organise by OKF", matter: "New matter", okf: "Turn on OKF" },
  sk: { client: "Pridať klienta", folder: "Pridať priečinok", organize: "Usporiadať podľa OKF", matter: "Nová vec", okf: "Zapnúť OKF" },
  cs: { client: "Přidat klienta", folder: "Přidat složku", organize: "Uspořádat podle OKF", matter: "Nová věc", okf: "Zapnout OKF" },
  de: { client: "Mandant hinzufügen", folder: "Ordner hinzufügen", organize: "Nach OKF ordnen", matter: "Neue Angelegenheit", okf: "OKF einschalten" },
};

/** "Zapnúť OKF": shown only while OKF is not on. */
export function EnableOkfAction({ compact = false, okfOffered }: { compact?: boolean; okfOffered?: boolean }) {
  const navigate = useNavigate();
  const label = labels[useLocale()].okf;
  const loaded = useOkfOffered(okfOffered !== undefined);
  if (!(okfOffered ?? loaded)) return null;
  return (
    <Button
      variant="outline"
      size={compact ? "icon-xs" : "sm"}
      onClick={() => navigate(ENABLE_OKF_ROUTE)}
      aria-label={label}
      title={label}
    >
      <FolderTree className="size-4" />
      {compact ? null : <span>{label}</span>}
    </Button>
  );
}

/** Shared entry points. The welcome route renders the same client and matter forms. */
export function OnboardingEntryActions({
  compact = false,
}: {
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const text = labels[useLocale()];
  const { connection } = useOkfConnection();
  const active = activeWorkspace(connection);
  // Interný domovský priestor nie je priečinok advokáta, usporiadať sa nedá.
  const organizePath = active?.path && !isLawossHomeWorkspace(active) ? active.path : undefined;
  return (
    <div className={compact ? "flex gap-1" : "flex flex-wrap gap-2"}>
      <Button
        variant="outline"
        size={compact ? "icon-xs" : "sm"}
        onClick={() => navigate("/welcome?continue=client")}
        aria-label={text.client}
        title={text.client}
      >
        <UserPlus className="size-4" />
        {compact ? null : <span>{text.client}</span>}
      </Button>
      <Button
        variant="outline"
        size={compact ? "icon-xs" : "sm"}
        onClick={() => navigate(ADD_FOLDER_PATH)}
        aria-label={text.folder}
        title={text.folder}
      >
        <FolderInput className="size-4" />
        {compact ? null : <span>{text.folder}</span>}
      </Button>
      {organizePath ? (
        <Button
          variant="outline"
          size={compact ? "icon-xs" : "sm"}
          onClick={() => navigate(organizeFolderLink(organizePath))}
          aria-label={text.organize}
          title={text.organize}
        >
          <FolderTree className="size-4" />
          {compact ? null : <span>{text.organize}</span>}
        </Button>
      ) : null}
      <Button
        variant="outline"
        size={compact ? "icon-xs" : "sm"}
        onClick={() => navigate(NEW_MATTER_PATH)}
        aria-label={text.matter}
        title={text.matter}
      >
        <FolderPlus className="size-4" />
        {compact ? null : <span>{text.matter}</span>}
      </Button>
    </div>
  );
}
