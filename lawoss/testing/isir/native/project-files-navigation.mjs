import { installChooserBoundary } from "./chooser-boundary.mjs";

// Executed in the renderer, using ordinary sidebar/breadcrumb handlers only.
function navigateProjectFiles(expected, phase) {
  const visible = node => Boolean(node?.isConnected && !node.closest('[hidden]') &&
    node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
  const enabled = node => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true';
  const titles = [...document.querySelectorAll('button')].filter(node =>
    node.textContent.trim() === expected.name && node.closest('[data-slot="collapsible"]') && enabled(node));
  if (titles.length !== 1) return false;
  const title = titles[0];
  if (phase === 'expand') {
    if (title.getAttribute('aria-expanded') === 'true') return true;
    if (title.getAttribute('aria-expanded') !== 'false') return false;
    title.click();
    return true;
  }
  const group = title.closest('[data-slot="collapsible"]');
  const controls = [...group.querySelectorAll('button,a')].filter(node => node.textContent.trim() === 'Files' && enabled(node));
  if (controls.length !== 1) return false;
  const files = controls[0], pressed = files.getAttribute('aria-pressed');
  if (phase === 'open') {
    if (pressed === 'true') return true;
    if (pressed !== 'false') return false;
    files.click();
    return true;
  }
  if (pressed !== 'true') return false;
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
  const folder = panel.querySelector('[data-project-folder="Dokumenty"]');
  return state.folderPathEqual && state.rootBreadcrumbEqual && root.getAttribute('aria-current') === 'location' && enabled(folder);
}

export async function openNativeProjectFiles({cdp,until,workspace,caseIndex}) {
  const expected = {id:workspace.id,root:workspace.path,name:workspace.name,caseIndex};
  await cdp.evaluate(`(${installChooserBoundary.toString()})(${JSON.stringify(expected)})`);
  const read = phase => cdp.evaluate(`(${navigateProjectFiles.toString()})(${JSON.stringify(expected)},${JSON.stringify(phase)})`);
  await until(()=>read('expand'),`select native project ${workspace.id}`);
  await until(()=>read('open'),'native project files action');
  await until(()=>read('panel'),'native processing panel');
  await until(()=>read('root'),'native root breadcrumb');
}
