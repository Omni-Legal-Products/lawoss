// Runs in the actual renderer. References and raw comparison operands never
// leave this test-owned observer; receipts contain only allowlisted metadata.
export function installChooserBoundary(expected) {
  window.__isirChooserBoundary?.disconnect();
  let captured = null, last = '', dropped = 0;
  const records = [];
  const visible = node => Boolean(node?.isConnected && node.getBoundingClientRect().width > 0);
  const sample = (phase, eventInput = null) => {
    const panels = [...document.querySelectorAll('[data-files-workspace-id]')].filter(visible);
    const panel = panels.length === 1 ? panels[0] : null;
    const folder = panel?.querySelector('[data-project-folder="Dokumenty"]');
    const trigger = folder?.closest('[data-slot="context-menu-trigger"]');
    const row = trigger?.parentElement;
    // WorkspaceEntryMenu is a fragment: its input follows its own trigger.
    // The list parent also contains other entries' inputs, not one owned row.
    const inputs = [];
    for (let node = trigger?.nextElementSibling; node?.matches('input[type="file"]'); node = node.nextElementSibling) inputs.push(node);
    const input = inputs.length === 1 ? inputs[0] : null;
    const nav = panel?.querySelector('[aria-label="Current folder"]');
    const route = window.__legalwork?.slice('route');
    const clientIdentity = panel ? Number(panel.dataset.filesClientIdentity) : null;
    const queries = (globalThis.__owReactQueryClient?.getQueryCache().findAll({ queryKey: ['workspace-files'] }) ?? []).filter(q =>
      panel && q.queryKey[1] === panel.dataset.filesWorkspaceId && q.queryKey[3] === clientIdentity &&
      q.queryKey[4] === panel.dataset.filesWorkspaceRoot && q.queryKey[5] === panel.dataset.filesFolderPath && q.getObserversCount() > 0);
    const query = queries.length === 1 ? queries[0] : null;
    const open = [...document.querySelectorAll('[data-slot="context-menu-trigger"][data-popup-open]')].filter(visible);
    const state = {
      caseIndex: expected.caseIndex, panelCount: panels.length,
      selectedOwnerEqual: route?.selectedWorkspaceId === expected.id,
      runtimeOwnerEqual: panel?.dataset.filesWorkspaceId === expected.id,
      workspaceRootEqual: panel?.dataset.filesWorkspaceRoot === expected.root,
      folderPathEqual: panel?.dataset.filesFolderPath === '',
      rootBreadcrumbEqual: nav?.querySelector('button')?.textContent.trim() === expected.name,
      physicalScopeEqual: Boolean(panel && nav && row && input && panel.contains(nav) && panel.contains(row) && row.contains(input)),
      rowPresent: Boolean(folder), inputCount: inputs.length, inputConnected: Boolean(input?.isConnected),
      clientIdentity: Number.isInteger(clientIdentity) ? clientIdentity : null,
      queryCount: queries.length, queryPending: query?.state.status === 'pending', queryError: query?.state.status === 'error', queryFetching: query?.state.fetchStatus === 'fetching',
      openTriggerCount: open.length, expectedTriggerOpen: Boolean(trigger && open.includes(trigger)),
      capturedConnected: captured ? captured.input.isConnected : null,
      panelGenerationEqual: captured ? captured.panel === panel : null,
      inputGenerationEqual: captured ? captured.input === input : null,
      documentGenerationEqual: captured ? captured.document === document : null,
      eventInputEqual: eventInput ? captured?.input === eventInput : null,
    };
    const encoded = JSON.stringify(state);
    if (phase !== 'mutation' || encoded !== last) {
      if (records.length === 64) { records.shift(); dropped++; }
      records.push({ phase, ...state }); last = encoded;
    }
    return { state, panel, input, trigger };
  };
  const observer = new MutationObserver(() => sample('mutation'));
  observer.observe(document.body, { subtree: true, childList: true, attributes: true });
  window.__isirChooserBoundary = {
    sample: phase => sample(phase).state,
    capture() { const current = sample('before-upload'); captured = current.input ? { input: current.input, panel: current.panel, document } : null; return current.state; },
    event(input) { return sample('native-event', input).state; },
    receipt() { sample('receipt'); return { schema: 1, records, dropped }; },
    disconnect() { observer.disconnect(); },
  };
  sample('before-selection');
}
