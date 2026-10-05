/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FolderTree } from "lucide-react";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useOkfConnection } from "../../okf/read-model";
import { triageLink } from "./api";

/**
 * Vstup do roztriedenia. S `root` vedie priamo na daný klon (onboarding po vytvorení klona),
 * bez neho sa ukáže len vtedy, keď je aktívny klient skúšobný klon.
 */
export function TriageEntry({ root, className = "lw-triage-entry" }: { root?: string; className?: string }) {
  const locale = useLocale();
  const { connection } = useOkfConnection();
  const [trialRoot, setTrialRoot] = useState<string | null>(null);
  useEffect(() => {
    if (root || !connection?.client) return;
    let alive = true;
    connection.client.onboardingStatus().then(
      (status) => { if (alive) setTrialRoot(status.profile?.trial && status.profile.clientRoot ? status.profile.clientRoot : null); },
      () => { if (alive) setTrialRoot(null); },
    );
    return () => { alive = false; };
  }, [connection, root]);
  const target = root ?? trialRoot;
  if (!target) return null;
  return <Link className={className} to={triageLink(target)} data-lawoss="triage-entry"><FolderTree aria-hidden size={15} /> {t(root ? "lawoss.triage.trial_entry" : "lawoss.triage.title", locale)}</Link>;
}
