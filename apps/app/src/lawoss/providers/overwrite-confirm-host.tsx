import { useEffect, useSyncExternalStore } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { t } from "@/i18n";
import { providerOverwriteConfirmStore, settleProviderOverwriteConfirm } from "./overwrite-confirm";

/** LAWOSS: potvrdenie prepisu poskytovateľa u ďalších klientov (Zrušiť / Uložiť pre všetkých). */
export function ProviderOverwriteConfirmHost() {
  useEffect(() => providerOverwriteConfirmStore.attachHost(), []);
  const conflicts = useSyncExternalStore(providerOverwriteConfirmStore.subscribe, providerOverwriteConfirmStore.snapshot, providerOverwriteConfirmStore.snapshot);
  return (
    <AlertDialog open={Boolean(conflicts)} onOpenChange={(open) => { if (!open) settleProviderOverwriteConfirm(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("lawoss.integrations.providerOverwrite.title")}</AlertDialogTitle>
          {conflicts?.map((conflict) => (
            <AlertDialogDescription key={conflict.providerId}>
              {t("lawoss.integrations.providerOverwrite.description", { provider: conflict.providerId })}
            </AlertDialogDescription>
          ))}
        </AlertDialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {[...new Map((conflicts ?? []).flatMap((conflict) => conflict.workspaces).map((workspace) => [workspace.id, workspace])).values()].map((workspace) => (
            <li key={workspace.id}>{workspace.name}</li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("lawoss.integrations.providerOverwrite.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => settleProviderOverwriteConfirm(true)}>
            {t("lawoss.integrations.providerOverwrite.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
