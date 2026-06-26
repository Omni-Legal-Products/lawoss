/** @jsxImportSource react */
import {
  useEffect,
  useMemo,
  useReducer,
  type SetStateAction,
} from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "../../../i18n";
import { CreateWorkspaceLocalPanel } from "./create-workspace-local-panel";
import {
  createInitialWorkspaceLocalState,
  createWorkspaceLocalReducer,
  type CreateWorkspaceLocalState,
} from "./create-workspace-modal-state";
import type { CreateWorkspaceModalProps } from "./types";

export function CreateWorkspaceModal(props: CreateWorkspaceModalProps) {
  const [localState, dispatchLocal] = useReducer(
    createWorkspaceLocalReducer,
    undefined,
    () => createInitialWorkspaceLocalState(),
  );
  const { selectedFolder, pickingFolder, showProgressDetails, now } = localState;
  const setLocal = <K extends keyof CreateWorkspaceLocalState>(
    key: K,
    value: SetStateAction<CreateWorkspaceLocalState[K]>,
  ) => dispatchLocal({ type: "set", key, value });
  const setSelectedFolder = (value: SetStateAction<string | null>) => setLocal("selectedFolder", value);
  const setPickingFolder = (value: SetStateAction<boolean>) => setLocal("pickingFolder", value);
  const setShowProgressDetails = (value: SetStateAction<boolean>) => setLocal("showProgressDetails", value);
  const setNow = (value: SetStateAction<number>) => setLocal("now", value);
  const preset = props.defaultPreset ?? "starter";

  const showClose = props.showClose ?? true;
  const submitting = props.submitting ?? false;
  const workerSubmitting = props.workerSubmitting ?? false;
  const progress = props.submittingProgress ?? null;
  const workerDisabled = Boolean(props.workerDisabled);
  const workerDisabledReason = (props.workerDisabledReason ?? "").trim();
  const workerDebugLines = useMemo(
    () => (props.workerDebugLines ?? []).flatMap((line) => {
      const trimmed = line.trim();
      return trimmed ? [trimmed] : [];
    }),
    [props.workerDebugLines],
  );
  const hasSelectedFolder = Boolean(selectedFolder?.trim());
  const localError = (props.localError ?? "").trim() || null;
  const elapsedSeconds = useMemo(() => {
    if (!progress?.startedAt) return 0;
    return Math.max(0, Math.floor((now - progress.startedAt) / 1000));
  }, [now, progress]);

  const headerTitle = props.title ?? t("dashboard.create_local_workspace_title");
  const headerSubtitle = props.subtitle ?? t("dashboard.create_local_workspace_subtitle");

  // Reset state when the modal opens.
  useEffect(() => {
    if (!props.open) return;
    dispatchLocal({ type: "reset" });
  }, [props.open]);

  // Tick the "elapsed" clock while submitting.
  useEffect(() => {
    if (!submitting) {
      setShowProgressDetails(false);
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [submitting]);

  const handlePickFolder = async () => {
    if (pickingFolder) return;
    setPickingFolder(true);
    try {
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(null)),
      );
      const next = await props.onPickFolder();
      if (next) setSelectedFolder(next);
    } finally {
      setPickingFolder(false);
    }
  };

  const handleLocalSubmit = async () => {
    props.onConfirm(preset, selectedFolder);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent
        showCloseButton={showClose}
        className="flex max-h-[90vh] min-h-0 w-full max-w-xl flex-col overflow-hidden sm:max-w-xl"
      >
        <DialogHeader className="flex-row">
          <div className="min-w-0 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{headerTitle}</DialogTitle>
            </div>
            <DialogDescription>{headerSubtitle}</DialogDescription>
          </div>
        </DialogHeader>

        <CreateWorkspaceLocalPanel
          selectedFolder={selectedFolder}
          hasSelectedFolder={hasSelectedFolder}
          pickingFolder={pickingFolder}
          onPickFolder={() => void handlePickFolder()}
          submitting={submitting}
          localError={localError}
          onClose={props.onClose}
          onSubmit={() => void handleLocalSubmit()}
          confirmLabel={props.confirmLabel}
          workerLabel={props.workerLabel}
          onConfirmWorker={props.onConfirmWorker}
          preset={preset}
          workerSubmitting={workerSubmitting}
          workerDisabled={workerDisabled}
          workerDisabledReason={workerDisabledReason}
          workerCtaLabel={props.workerCtaLabel}
          workerCtaDescription={props.workerCtaDescription}
          onWorkerCta={props.onWorkerCta}
          workerRetryLabel={props.workerRetryLabel}
          onWorkerRetry={props.onWorkerRetry}
          workerDebugLines={workerDebugLines}
          progress={progress}
          elapsedSeconds={elapsedSeconds}
          showProgressDetails={showProgressDetails}
          onToggleProgressDetails={() =>
            setShowProgressDetails((prev) => !prev)
          }
        />
      </DialogContent>
    </Dialog>
  );
}
