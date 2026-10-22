// Build-only desktop adapter. Explicit caller inputs select the supplier; only
// the current owned generation supplies the private digest compared to actual ASAR.
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createBuildInfo, assertReleaseSource } from '../../../scripts/release/build-info.mjs';
import { prepareProductSdkPackaging } from './product-packaging.mjs';
import { readProductSdkIdentityModule } from './product-identity.mjs';
import { readPackagedProductSdkIdentity } from './packaged-identity.mjs';
import { verifyPackagedProductSdk } from './packaged-resource.mjs';
import { currentProductSdkSourceSetSha256 } from './product-bundle.mjs';
import { verifyWorkspace } from './prepare.mjs';
import { canonical, sdkConsumerMode, SDK_LOCK_SHA256 } from './validate.mjs';

const DESKTOP_ROOT = fileURLToPath(new URL('../../../apps/desktop', import.meta.url));
const invalid = () => { throw Object.assign(new Error('DESKTOP_SDK_PACKAGING_INVALID'), { code: 'DESKTOP_SDK_PACKAGING_INVALID' }); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const unchanged = (a, b) => same(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const equal = (a, b) => canonical(a) === canonical(b);
async function absent(file) {
  try { await lstat(file); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
export function desktopProductSdkTarget(platform, arch) {
  const target = { platform, arch, ...(platform === 'linux' ? { libc: 'glibc' } : {}) };
  sdkConsumerMode(target, SDK_LOCK_SHA256);
  return Object.freeze(target);
}

/** Read-only equivalent of electron-build's existing identity inputs. */
export function desktopApplicationBuildInfo({ desktopRoot = DESKTOP_ROOT, target, env = process.env }) {
  const repoRoot = path.resolve(desktopRoot, '../..');
  const version = JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')).version;
  let gitSha;
  try { gitSha = assertReleaseSource(repoRoot, version); }
  catch (error) { if (version !== '0.0.0') throw error; return null; }
  return createBuildInfo({ version, gitSha,
    buildEpoch: execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    platform: target.platform, arch: target.arch, channel: version.includes('alpha') ? 'alpha' : 'stable',
    workflowRunUrl: env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '' });
}

export function parseDesktopSdkBuildArguments(args) {
  const options = new Map();
  const names = ['--sdk-mode', '--sdk-consumer-node', '--sdk-pnpm-cli', '--sdk-head', '--sdk-checkout'];
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!names.includes(key) || options.has(key) || typeof value !== 'string' || !value || value.length > 4096) invalid();
    options.set(key, value);
  }
  const mode = options.get('--sdk-mode') ?? 'without-sdk';
  if (mode === 'without-sdk') { if (options.size > (options.has('--sdk-mode') ? 1 : 0)) invalid(); return Object.freeze({ mode }); }
  if (mode !== 'native' || options.size !== names.length) invalid();
  const consumerNode = options.get('--sdk-consumer-node'), pnpmCli = options.get('--sdk-pnpm-cli');
  const headSha = options.get('--sdk-head'), checkoutSha = options.get('--sdk-checkout');
  if (![consumerNode, pnpmCli].every(value => path.isAbsolute(value)) || ![headSha, checkoutSha].every(value => /^[a-f0-9]{40}$/.test(value))) invalid();
  return Object.freeze({ mode, consumerNode: path.resolve(consumerNode), pnpmCli: path.resolve(pnpmCli), headSha, checkoutSha });
}

/** applicationBuild is the existing writer's result, never adjacent SDK metadata. */
export async function prepareDesktopProductSdkPackaging({ desktopRoot = DESKTOP_ROOT, target, applicationBuild, supplier = { mode: 'without-sdk' } }) {
  return prepareProductSdkPackaging({ desktopRoot, target, applicationBuild, supplier });
}
async function sourceIdentity(desktopRoot, expectedOwner) {
  const parent = path.join(desktopRoot, 'resources'), root = path.join(parent, '.plugin-sdk-build');
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root ||
    (expectedOwner && !same(stat, expectedOwner)) ||
    (typeof process.getuid === 'function' && (stat.uid !== process.getuid() || (stat.mode & 0o077)))) invalid();
  await verifyWorkspace(root);
  if (!await absent(path.join(parent, '..plugin-sdk-build.generation.lock'))) invalid();
  const owner = JSON.parse(await readFile(path.join(root, '.owner.json'), 'utf8'));
  if (expectedOwner && owner.token !== expectedOwner.token) invalid();
  const file = path.join(root, 'application-code/identity.mjs'), before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > 65536 || await realpath(file) !== file) invalid();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let primary;
  try {
    if (!unchanged(before, await handle.stat())) invalid();
    const bytes = Buffer.alloc(before.size + 1), { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== before.size) invalid();
    const text = bytes.subarray(0, bytesRead).toString('utf8');
    if (!Buffer.from(text).equals(bytes.subarray(0, bytesRead)) || !unchanged(before, await handle.stat()) || !unchanged(before, await lstat(file))) invalid();
    return { root, identity: readProductSdkIdentityModule(text), owner: { dev: stat.dev, ino: stat.ino, token: owner.token }, file: before };
  } catch (error) { primary = error; throw error; }
  finally {
    try { await handle.close(); }
    catch (cleanup) { if (primary) throw new AggregateError([primary, cleanup], 'Desktop SDK identity and close failed', { cause: primary }); throw cleanup; }
  }
}

/** Explicit applicationBuild is a trusted build-caller input for isolated/static
 * composition. Thin shipping callers omit it and derive current checkout inputs.
 * expectedMode is independently required by CI; local afterPack may use the
 * prepared source generation's mode, never the packed application's own claim. */
export async function verifyDesktopProductSdkPackaging({ desktopRoot = DESKTOP_ROOT, resourcesRoot, target, applicationBuild = desktopApplicationBuildInfo({ desktopRoot, target }), expectedMode }) {
  const source = await sourceIdentity(desktopRoot);
  const mode = expectedMode ?? source.identity.mode;
  if (!['sdk', 'without-sdk', 'development'].includes(mode) || source.identity.mode !== mode ||
    !equal(source.identity.target, target) || !equal(source.identity.applicationBuild, applicationBuild)) invalid();
  if (source.identity.sdk && source.identity.sdk.sourceSetSha256 !== await currentProductSdkSourceSetSha256()) invalid();
  const binding = { resourcesRoot, target, expectedMode: mode, applicationBuild };
  const packed = await readPackagedProductSdkIdentity(binding);
  if (!equal(source.identity, packed)) invalid();
  const result = await verifyPackagedProductSdk({ ...binding, validationParent: source.root });
  const finalSource = await sourceIdentity(desktopRoot, source.owner);
  const finalPacked = await readPackagedProductSdkIdentity(binding);
  if (!unchanged(source.file, finalSource.file) || !equal(source.identity, finalSource.identity) || !equal(source.identity, finalPacked) ||
    (source.identity.sdk && source.identity.sdk.sourceSetSha256 !== await currentProductSdkSourceSetSha256())) invalid();
  return result;
}
