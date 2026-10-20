/** CI/build tooling only. Installed LegalWork never invokes Docker. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attestProtectedEngineGuestVersion, protectedEngineVersion, provisionProtectedEngineAssets } from './protected-engine-assets.mjs';
import { readFile } from 'node:fs/promises';
const root = fileURLToPath(new URL('../../', import.meta.url));
const arch = process.argv[2] ?? process.arch;
if (!['arm64', 'x64'].includes(arch)) throw new Error('Guest architecture must be arm64 or x64');
const destination = resolve(process.argv[3] ?? `${root}/apps/server/resources/agent-sandbox/runtime`);
const image = `legalwork-sandbox-guest:${arch}`;
const reviewedVersion = JSON.parse(await readFile(resolve(root, 'constants.json'), 'utf8')).opencodeVersion?.replace(/^v/, '');
if (reviewedVersion !== protectedEngineVersion) throw new Error('Review protected engine assets for the configured engine version');
// Stage into the Docker context even when the caller selects another output.
// The guest executes these exact measured bytes before publication.
const contextRuntime = resolve(root, 'apps/server/resources/agent-sandbox/runtime');
await provisionProtectedEngineAssets({ architecture: arch, destination: contextRuntime, version: reviewedVersion });
copyFileSync(resolve(root, 'apps/server/resources/agent-sandbox/protected-engine.mjs'), resolve(contextRuntime, 'protected-engine.mjs'));
function run(args, capture = false) {
  const result = spawnSync('docker', args, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.status !== 0) throw new Error(`Guest build failed: ${result.stderr ?? result.error ?? args[0]}`);
  return result.stdout?.trim();
}
run(['build', '--platform', `linux/${arch === 'x64' ? 'amd64' : 'arm64'}`, '--tag', image,
  resolve(root, 'apps/server/resources/agent-sandbox')]);
mkdirSync(destination, { recursive: true });
const container = run(['create', image], true);
try { run(['cp', `${container}:/out/.`, destination]); }
finally { run(['rm', container]); }
// BuildKit's read-only mount is not included in the guest rootfs. Keep one
// packaged copy for the host-authorized read-only bundle, not duplicate ELF.
if (destination !== contextRuntime) {
  for (const name of ['protected-opencode', 'protected-opencode-manifest.json', 'protected-opencode-sbom.json', 'protected-engine.mjs']) copyFileSync(resolve(contextRuntime, name), resolve(destination, name));
}
await attestProtectedEngineGuestVersion(destination, arch);
