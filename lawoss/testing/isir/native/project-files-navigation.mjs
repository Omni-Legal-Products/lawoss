import { installChooserBoundary } from "./chooser-boundary.mjs";

// Executed in the renderer, using ordinary sidebar/breadcrumb handlers only.
function navigateProjectFiles(expected, phase) {
  const visible = node => Boolean(node?.isConnected && !node.closest('[hidden]') &&
    node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
  const enabled = node => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true';
  // LAWOSS sidebar rows can show a client-card name and a second status line; their exact native project
  // name stays on the label element. Without that element the whole title text must match, as before.
  const projectName = node => {
    const label = node.querySelector('[data-lawoss-row-label]');
    return label ? label.getAttribute('data-lawoss-native-name') : node.textContent.trim();
  };
  const titles = [...document.querySelectorAll('button')].filter(node =>
    projectName(node) === expected.name && node.closest('[data-slot="collapsible"]') && enabled(node));
  if (titles.length !== 1) return false;
  const title = titles[0];
  const group = title.closest('[data-slot="collapsible"]');
  if (phase === 'expand') {
    // The title opens the workspace. Its separate chevron owns expansion;
    // session-section chevrons and nested workspaces are not this control.
    const expanders = [...group.querySelectorAll('button[aria-expanded]')].filter(node =>
      node.closest('[data-slot="collapsible"]') === group &&
      ['Expand', 'Collapse'].includes(node.getAttribute('aria-label')) && enabled(node));
    if (expanders.length !== 1) return false;
    const expander = expanders[0], expanded = expander.getAttribute('aria-expanded');
    if (expanded === 'true') return true;
    if (expanded !== 'false') return false;
    expander.click();
    return true;
  }
  const controls = [...group.querySelectorAll('button,a')].filter(node =>
    node.closest('[data-slot="collapsible"]') === group && node.textContent.trim() === 'Files' && enabled(node));
  if (controls.length !== 1) return false;
  const files = controls[0];
  if (files.getAttribute('data-slot') !== 'sidebar-menu-sub-button') return false;
  // Base UI emits data-active="" for true and omits it for false. Only the
  // known sidebar component has that contract; arbitrary values fail closed.
  const active = files.getAttribute('data-active');
  if (active !== null && active !== '') return false;
  if (phase === 'open') {
    if (active === '') return true;
    files.click();
    return true;
  }
  if (active !== '') return false;
  const state = window.__isirChooserBoundary.sample('files-navigation');
  if (state.panelCount !== 1 || !state.selectedOwnerEqual || !state.runtimeOwnerEqual || !state.workspaceRootEqual) return false;
  const panels = [...document.querySelectorAll('[data-files-workspace-id]')].filter(visible);
  if (panels.length !== 1) return false;
  const panel = panels[0], processing = panel.querySelector('[aria-label="Document processing"]');
  const nav = panel.querySelector('[aria-label="Current folder"]'), root = nav?.querySelector('button');
  if (!visible(processing) || !visible(nav) || !visible(root) || root.textContent.trim() !== expected.name) return false;
  if (phase === 'panel') return true;
  if (phase === 'root' && !state.folderPathEqual) {
    if (!enabled(root)) return false;
    root.click();
    return false;
  }
  if (!state.folderPathEqual || !state.rootBreadcrumbEqual || root.getAttribute('aria-current') !== 'location') return false;
  // Only the explicit pre-reconnect call can acknowledge the production error
  // branch. It has no directory rows; ordinary navigation remains strict.
  const controlsAtRoot = expected.readiness === 'reconnect'
    ? [...panel.querySelectorAll('button')].filter(node => node.textContent.trim() === 'Reconnect project folder')
    : [...panel.querySelectorAll('[data-project-folder="Dokumenty"]')];
  return controlsAtRoot.length === 1 && enabled(controlsAtRoot[0]);
}

export async function openNativeProjectFiles({cdp,until,workspace,caseIndex,readiness='listing'}) {
  if (!['listing','reconnect'].includes(readiness)) throw new TypeError('Unknown native Files readiness');
  const expected = {id:workspace.id,root:workspace.path,name:workspace.name,caseIndex,readiness};
  await cdp.evaluate(`(${installChooserBoundary.toString()})(${JSON.stringify(expected)})`);
  const read = phase => cdp.evaluate(`(${navigateProjectFiles.toString()})(${JSON.stringify(expected)},${JSON.stringify(phase)})`);
  await until(()=>read('expand'),`select native project ${workspace.id}`);
  await until(()=>read('open'),'native project files action');
  await until(()=>read('panel'),'native processing panel');
  await until(()=>read('root'),'native root breadcrumb');
}
