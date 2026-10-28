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
import { Button } from "@/components/ui/button";
import { chatTrimConfirmStore, chatTrimCopy, settleChatTrimConfirm } from "./trim-confirm";

/** LAWOSS: potvrdenie pred skrátením rozhovoru alebo úpravou správy (Zrušiť / Rozvetviť do nového chatu / Skrátiť rozhovor). */
export function ChatTrimConfirmHost() {
  useEffect(() => chatTrimConfirmStore.attachHost(), []);
  const request = useSyncExternalStore(chatTrimConfirmStore.subscribe, chatTrimConfirmStore.snapshot, chatTrimConfirmStore.snapshot);
  if (!request) return null;
  const copy = chatTrimCopy(request);
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) settleChatTrimConfirm("cancel"); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
          <AlertDialogDescription>{copy.files}</AlertDialogDescription>
          {copy.changed ? <AlertDialogDescription>{copy.changed}</AlertDialogDescription> : null}
          {copy.hint ? <AlertDialogDescription>{copy.hint}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
          {copy.fork ? (
            <Button variant="outline" onClick={() => settleChatTrimConfirm("fork")}>
              {copy.fork}
            </Button>
          ) : null}
          <AlertDialogAction onClick={() => settleChatTrimConfirm("trim")}>{copy.confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
