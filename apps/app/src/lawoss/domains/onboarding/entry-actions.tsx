/** @jsxImportSource react */
import { UserPlus, FolderPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/i18n/use-locale";

/** Shared entry points. The welcome route renders the same client and matter forms. */
export function OnboardingEntryActions({
  compact = false,
}: {
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const locale = useLocale();
  const labels = {
    en: { client: "Add client", matter: "New matter" },
    sk: { client: "Pridať klienta", matter: "Nová vec" },
    cs: { client: "Přidat klienta", matter: "Nová věc" },
    de: { client: "Mandant hinzufügen", matter: "Neue Angelegenheit" },
  }[locale];
  return (
    <div className={compact ? "flex gap-1" : "flex flex-wrap gap-2"}>
      <Button
        variant="outline"
        size={compact ? "icon-xs" : "sm"}
        onClick={() => navigate("/welcome?continue=client")}
        aria-label={labels.client}
        title={labels.client}
      >
        <UserPlus className="size-4" />
        {compact ? null : <span>{labels.client}</span>}
      </Button>
      <Button
        variant="outline"
        size={compact ? "icon-xs" : "sm"}
        onClick={() => navigate("/welcome?continue=matter")}
        aria-label={labels.matter}
        title={labels.matter}
      >
        <FolderPlus className="size-4" />
        {compact ? null : <span>{labels.matter}</span>}
      </Button>
    </div>
  );
}
