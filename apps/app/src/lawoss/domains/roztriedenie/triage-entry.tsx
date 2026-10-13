/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FolderTree } from "lucide-react";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { activeWorkspace, useOkfConnection } from "../../okf/read-model";
import { offersTriageEntry, triageLink, triageStatus, triageTargetRoot } from "./api";

/**
 * Vstup do roztriedenia. S `root` vedie priamo na daný klon (onboarding po vytvorení klona),
 * bez neho na skúšobný klon z onboardingu, inak na aktívneho klienta usporiadaného na mieste (D1 9. 10.).
 */
export function TriageEntry({ root, className = "lw-triage-entry" }: { root?: string; className?: string }) {
  const locale = useLocale();
  const { connection } = useOkfConnection();
  const [found, setFound] = useState<string | null>(null);
  useEffect(() => {
    const client = connection?.client;
    if (root || !client) return;
    let alive = true;
    void (async () => {
      const status = await client.onboardingStatus().catch(() => null);
      const trialRoot = status?.profile?.trial && status.profile.clientRoot ? status.profile.clientRoot : null;
      const target = triageTargetRoot({ trialRoot, activeRoot: activeWorkspace(connection)?.path });
      // Klient bez súhlasu s usporiadaním („Nie“) vstup nedostane; server by ho aj tak odmietol.
      const offered = trialRoot ?? (target && offersTriageEntry(await triageStatus(client, target).catch(() => null)) ? target : null);
      if (alive) setFound(offered);
    })();
    return () => { alive = false; };
  }, [connection, root]);
  const target = root ?? found;
  if (!target) return null;
  return <Link className={className} to={triageLink(target)} data-lawoss="triage-entry"><FolderTree aria-hidden size={15} /> {t(root ? "lawoss.triage.trial_entry" : "lawoss.triage.title", locale)}</Link>;
}
