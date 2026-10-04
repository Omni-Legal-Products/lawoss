/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { FolderPlus, FolderTree, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/i18n/use-locale";
import { createLegalworkServerClient } from "@/app/lib/legalwork-server";
import { resolveLegalworkConnection } from "@/react-app/shell/legalwork-connection";
import type { OkfChoice } from "./api";

/** The welcome flow reopened at the OKF choice. */
export const ENABLE_OKF_ROUTE = "/welcome?continue=okf";

/** Offer OKF until it is on; an unreadable status still offers it (the link only opens the choice). */
export function offersOkf(status: { profile: { okf?: OkfChoice } | null } | null): boolean {
  return status?.profile?.okf?.enabled !== true;
}

/** `undefined` while the onboarding status is loading. */
function useOkfOffered(skip: boolean): boolean | undefined {
  const [offered, setOffered] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    void resolveLegalworkConnection()
      .then(({ normalizedBaseUrl, resolvedToken, resolvedHostToken }) =>
        createLegalworkServerClient({
          baseUrl: normalizedBaseUrl,
          token: resolvedToken || undefined,
          hostToken: resolvedHostToken || undefined,
        }).onboardingStatus(),
      )
      .then((status) => { if (!cancelled) setOffered(offersOkf(status)); })
      .catch(() => { if (!cancelled) setOffered(offersOkf(null)); });
    return () => { cancelled = true; };
  }, [skip]);
  return offered;
}

const labels = {
  en: { client: "Add client", matter: "New matter", okf: "Turn on OKF" },
  sk: { client: "Pridať klienta", matter: "Nová vec", okf: "Zapnúť OKF" },
  cs: { client: "Přidat klienta", matter: "Nová věc", okf: "Zapnout OKF" },
  de: { client: "Mandant hinzufügen", matter: "Neue Angelegenheit", okf: "OKF einschalten" },
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
  okfOffered,
}: {
  compact?: boolean;
  /** Test seam; by default the onboarding status decides. */
  okfOffered?: boolean;
}) {
  const navigate = useNavigate();
  const text = labels[useLocale()];
  return (
    <div className={compact ? "flex gap-1" : "flex flex-wrap gap-2"}>
      <EnableOkfAction compact={compact} okfOffered={okfOffered} />
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
        onClick={() => navigate("/welcome?continue=matter")}
        aria-label={text.matter}
        title={text.matter}
      >
        <FolderPlus className="size-4" />
        {compact ? null : <span>{text.matter}</span>}
      </Button>
    </div>
  );
}
