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
import { hasEndpointChange, providerOverwriteConfirmStore, providerOverwriteCopy, settleProviderOverwriteConfirm } from "./overwrite-confirm";

/** LAWOSS: potvrdenie prepisu alebo odpojenia poskytovateľa u ďalších klientov (Zrušiť / Uložiť pre všetkých, Odpojiť pre všetkých). */
export function ProviderOverwriteConfirmHost() {
  useEffect(() => providerOverwriteConfirmStore.attachHost(), []);
  const request = useSyncExternalStore(providerOverwriteConfirmStore.subscribe, providerOverwriteConfirmStore.snapshot, providerOverwriteConfirmStore.snapshot);
  const conflicts = request?.conflicts ?? [];
  const copy = providerOverwriteCopy(request?.mode ?? "save", "", hasEndpointChange(conflicts));
  return (
    <AlertDialog open={Boolean(request)} onOpenChange={(open) => { if (!open) settleProviderOverwriteConfirm(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          {conflicts.map((conflict) => (
            <AlertDialogDescription key={conflict.providerId}>
              {providerOverwriteCopy(request?.mode ?? "save", conflict.providerId, conflict.reason === "endpoint_change").description}
            </AlertDialogDescription>
          ))}
        </AlertDialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {[...new Map(conflicts.flatMap((conflict) => conflict.workspaces).map((workspace) => [workspace.id, workspace])).values()].map((workspace) => (
            <li key={workspace.id}>{workspace.name}</li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
          <AlertDialogAction variant={request?.mode === "remove" ? "destructive" : "default"} onClick={() => settleProviderOverwriteConfirm(true)}>
            {copy.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
