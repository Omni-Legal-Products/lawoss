// Private synthetic startup observations; returned is not an operation-success claim.
export const alphaStartupPhases = Object.freeze([
  'main-configured', 'icons-entered', 'icons-returned', 'services-returned', 'runtime-manager-returned',
  'single-instance-entered', 'single-instance-rejected', 'single-instance-acquired',
  'ready-registering', 'ready-registered', 'ready-entered',
  'actaport-bundle-entered', 'actaport-bundle-returned',
  'actaport-environment-entered', 'actaport-environment-returned',
  'runtime-prepare-entered', 'runtime-prepare-returned',
  'workspace-migrate-entered', 'workspace-migrate-returned',
  'opencode-config-entered', 'opencode-config-returned',
  'workflows-migrate-entered', 'workflows-migrate-returned',
  'ui-control-entered', 'ui-control-returned',
]);

export function createAlphaStartupCheckpoints({ platform, optIn, isolated, write }) {
  if (platform !== 'win32' || optIn !== '1' || isolated !== true) return () => {};
  const seen = new Set();
  return phase => {
    if (!alphaStartupPhases.includes(phase) || seen.has(phase)) return;
    seen.add(phase);
    try { write(`[lawoss-alpha-startup] ${phase}`); } catch { /* Observation cannot replace startup. */ }
  };
}
