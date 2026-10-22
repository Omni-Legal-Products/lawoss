import { ensureWorkspaceSessionSync, snapshotKey, trackWorkspaceSessionSync } from "../sync/session-sync";
import { useEffect, useMemo } from "react";
import { createClient } from "@/app/lib/opencode";
import { useSessionInteractions } from "../sync/use-session-interactions";
import { SessionSurface, type SessionSurfaceProps } from "../surface/session-surface";
import { useModelPicker } from "../modals/use-model-picker";
import { ModelPickerModal } from "../modals/model-picker-modal";
import { useModelBehavior } from "../surface/use-model-behavior";
import { useProviderListQuery, isModelAvailableInConnectedProviders } from "@/react-app/infra/provider-list-query";
import { chatModelKey, useSessionModelStore } from "./session-model-store";
import { resolveModelDisplayName } from "@/app/utils";
import type { ModelRef } from "@/app/types";
import type { LegalworkSessionSnapshot } from "@/app/lib/legalwork-server";
import { useQueryCacheState } from "@/react-app/infra/query-cache-state";
import { effectiveSessionDirectory } from "@/lawoss/shell/session-directory";

/** Each open chat owns its approvals, questions and todos. Focusing a different
 * tab changes navigation, never the session to which an action is addressed. */
export function WorkspaceChat(props: SessionSurfaceProps & { clientRoot: string }) {
  // LAWOSS: each chat follows its own folder (a case chat runs in its case subfolder), from
  // its loaded snapshot; the client root until then. Events, status and permission requests
  // of a chat exist only in its folder's engine instance.
  const loadedKey = useMemo(() => snapshotKey(props.workspaceId, props.sessionId), [props.workspaceId, props.sessionId]);
  const loaded = useQueryCacheState<LegalworkSessionSnapshot | null>(loadedKey, null);
  const directory = effectiveSessionDirectory({ path: props.clientRoot, workspaceType: props.isRemoteWorkspace ? "remote" : "local" },
    loaded?.session.id === props.sessionId ? loaded.session : null);
  const client = useMemo(() => createClient(props.opencodeBaseUrl, directory || undefined,
    { token: props.legalworkToken, mode: "legalwork" }), [props.opencodeBaseUrl, directory, props.legalworkToken]);
  useEffect(() => {
    const input = { workspaceId: props.workspaceId, baseUrl: props.opencodeBaseUrl, legalworkToken: props.legalworkToken, directory: directory || undefined };
    const releaseWorkspace = ensureWorkspaceSessionSync(input);
    const releaseSession = trackWorkspaceSessionSync(input, props.sessionId);
    return () => { releaseSession(); releaseWorkspace(); };
  }, [props.workspaceId, props.opencodeBaseUrl, props.legalworkToken, props.sessionId, directory]);
  const interactions = useSessionInteractions({ client, serverClient: props.client, workspaceId: props.workspaceId, sessionId: props.sessionId, workspaceRoot: directory });
  const key = chatModelKey(props.opencodeBaseUrl, props.workspaceId, props.sessionId);
  const stored = useSessionModelStore(state => state.selections[key]);
  const selection = stored ?? { model: props.selectedModel, variant: props.modelVariant };
  useEffect(() => {
    if (props.selectedModel.providerID && props.selectedModel.modelID) useSessionModelStore.getState().initialize(key, { model: props.selectedModel, variant: props.modelVariant });
  }, [key, props.selectedModel, props.modelVariant]);
  const picker = useModelPicker({ client, baseUrl: props.opencodeBaseUrl, workspaceRoot: directory, listenForDefaults: false });
  const providers = useProviderListQuery({ client, baseUrl: props.opencodeBaseUrl, directory: directory || undefined });
  const unavailable = Boolean(providers.data && !isModelAvailableInConnectedProviders(providers.data, selection.model));
  const behavior = useModelBehavior({ providerList: providers.data, defaultModel: selection.model, modelVariant: selection.variant });
  const select = (model: ModelRef) => {
    useSessionModelStore.getState().select(key, { model, variant: selection.model.providerID === model.providerID && selection.model.modelID === model.modelID ? selection.variant : null });
    props.onModelChange(model);
    picker.setCompactOpen(false); picker.setOpen(false);
  };
  return <div className="h-full min-h-0" data-workspace-chat={props.sessionId} data-workspace-tab-active={props.active !== false}>
    <SessionSurface {...props} {...interactions} workspaceRoot={directory}
      selectedModel={selection.model} modelLabel={resolveModelDisplayName(selection.model.modelID)}
      modelUnavailable={unavailable} modelSelectorLocked={props.modelSelectorLocked && !unavailable}
      modelPickerOpen={picker.compactOpen} onModelPickerOpenChange={picker.setCompactOpen}
      onModelClick={() => picker.setOpen(true)} onModelChange={select} onChangeModel={select}
      modelVariant={behavior.modelVariantValue} modelVariantLabel={behavior.modelVariantLabel} modelBehaviorOptions={behavior.modelBehaviorOptions}
      onModelVariantChange={variant => useSessionModelStore.getState().select(key, { model: selection.model, variant })}
      onSendDraft={(draft, id, options) => props.onSendDraft(draft, id, { ...options, modelSelection: { model: selection.model, variant: behavior.modelVariantValue } })}
    />
    <ModelPickerModal open={picker.open} options={picker.options} query={picker.query} setQuery={picker.setQuery}
      target="session" current={selection.model} onSelect={select} onBehaviorChange={(model, variant) => useSessionModelStore.getState().select(key, { model, variant })}
      onOpenSettings={() => { picker.setOpen(false); props.onOpenSettingsSection?.("providers"); }} onClose={() => picker.setOpen(false)} />
  </div>;
}
