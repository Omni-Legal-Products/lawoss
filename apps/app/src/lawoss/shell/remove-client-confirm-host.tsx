import { useEffect, useSyncExternalStore } from "react";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { removeClientConfirmStore, removeClientCopy, settleRemoveClientConfirm } from "./remove-client-confirm";

/** LAWOSS: okno „Odobrať klienta“ (Zrušiť / Odobrať klienta). Súbory na disku sa nemažú, preto varovanie, nie červené. */
export function RemoveClientConfirmHost() {
  useEffect(() => removeClientConfirmStore.attachHost(), []);
  const open = useSyncExternalStore(removeClientConfirmStore.subscribe, removeClientConfirmStore.snapshot, removeClientConfirmStore.snapshot);
  if (!open) return null;
  const copy = removeClientCopy();
  return (
    <ConfirmModal
      open
      title={copy.title}
      message={copy.message}
      confirmLabel={copy.confirm}
      cancelLabel={copy.cancel}
      variant="warning"
      onConfirm={() => settleRemoveClientConfirm(true)}
      onCancel={() => settleRemoveClientConfirm(false)}
    />
  );
}
