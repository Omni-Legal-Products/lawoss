import { ArrowRight, KeyRound } from "lucide-react";
import { LegalworkServerError } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export function StorageAccessError({ error, provider, onRetry, onConnectStorage }: {
  error: Error;
  provider?: string;
  onRetry: () => void;
  onConnectStorage?: () => void;
}) {
  const needsSignIn = error instanceof LegalworkServerError && [
    "storage_signin_required", "storage_disconnected", "connector_signin_required", "connector_reconnect_required",
  ].includes(error.code);
  const accountProvider = provider === "google-drive" ? "Google"
    : provider && ["onedrive", "onedrive-personal", "sharepoint-files"].includes(provider) ? "Microsoft" : undefined;
  if (needsSignIn) return (
    <div role="status" className="rounded-lg border border-border/50 bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
        {t("storage.signin_title")}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{accountProvider
        ? t("storage.signin_provider_description", { provider: accountProvider })
        : t("storage.signin_description")}</p>
      {onConnectStorage && <Button variant="outline" size="sm" className="mt-3 h-7 w-full justify-between text-xs" onClick={onConnectStorage}>
        {t("storage.open_connectors")}
        <ArrowRight className="size-3.5" />
      </Button>}
    </div>
  );
  return (
    <div role="alert" className="text-xs text-destructive">
      <p className="break-words">{error.message}</p>
      <Button variant="ghost" size="sm" onClick={onRetry}>{t("storage.retry")}</Button>
    </div>
  );
}
