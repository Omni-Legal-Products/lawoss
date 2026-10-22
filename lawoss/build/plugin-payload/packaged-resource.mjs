// Static packaging admission only. Actual packed application code supplies the
// SDK digest; adjacent build metadata and resource JS supply no SDK authority.
import { constants } from 'node:fs';
import { lstat, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { readPackagedProductSdkIdentity } from './packaged-identity.mjs';
import { createProductSdkIdentityModule, readProductSdkIdentityModule } from './product-identity.mjs';
import { canonical } from './validate.mjs';
import { initialize, verifyWorkspace } from './prepare.mjs';
import { extractAndVerifyProductSdkCapsule } from './product-capsule-validation.mjs';

const invalid = () => { throw Object.assign(new Error('PACKAGED_SDK_RESOURCE_INVALID'), { code: 'PACKAGED_SDK_RESOURCE_INVALID' }); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const unchanged = (a, b) => same(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
function inputData(input) {
  const keys = ['resourcesRoot', 'target', 'expectedMode', 'applicationBuild', 'validationParent'];
  if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
  const fields = Object.getOwnPropertyDescriptors(input), actual = Reflect.ownKeys(fields);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) invalid();
  return Object.fromEntries(keys.map(key => {
    const field = fields[key];
    if (!field.enumerable || !Object.hasOwn(field, 'value')) invalid();
    return [key, field.value];
  }));
}
async function physical(root) {
  if (typeof root !== 'string' || root.length > 4096 || !path.isAbsolute(root) || path.resolve(root) !== root) invalid();
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root) invalid();
  return stat;
}
async function physicalText(file, limit) {
  const before = await lstat(file);
  const regular = stat => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size > 0 && stat.size <= limit;
  if (!regular(before) || await realpath(file) !== file) invalid();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let primary;
  try {
    if (!unchanged(before, await handle.stat())) invalid();
    const bytes = Buffer.alloc(before.size + 1), read = await handle.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead !== before.size) invalid();
    const content = bytes.subarray(0, before.size), text = content.toString('utf8');
    if (!Buffer.from(text).equals(content)) invalid();
    const after = await lstat(file);
    if (!regular(after) || !unchanged(before, after) || !unchanged(before, await handle.stat()) || await realpath(file) !== file) invalid();
    return text;
  } catch (error) { primary = error; throw error; }
  finally {
    try { await handle.close(); }
    catch (cleanup) { if (primary) throw new AggregateError([primary, cleanup], 'Packaged build metadata and close failed', { cause: primary }); throw cleanup; }
  }
}
const parse = text => { try { return JSON.parse(text); } catch { invalid(); } };
async function publicBuild(resourcesRoot, expected) {
  if (canonical(parse(await physicalText(path.join(resourcesRoot, 'build-info.json'), 8192))) !== canonical(expected)) invalid();
}
async function absent(file) {
  try { await lstat(file); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};
async function workspaceIdentity(root, expected) {
  const before = await physical(root);
  // Refuse a replacement before reading any child of the uncertain directory.
  if ((expected && !same(before, expected)) || (typeof process.getuid === 'function' &&
    (before.uid !== process.getuid() || (before.mode & 0o077)))) invalid();
  await verifyWorkspace(root);
  const owner = parse(await physicalText(path.join(root, '.owner.json'), 512));
  if (!owner || owner.schema !== 1 || owner.dev !== before.dev || owner.ino !== before.ino ||
    typeof owner.token !== 'string' || !/^[a-f0-9-]{36}$/.test(owner.token) ||
    (expected && owner.token !== expected.token) || !same(before, await physical(root))) invalid();
  return Object.freeze({ dev: before.dev, ino: before.ino, token: owner.token });
}

export async function verifyPackagedProductSdk(options) {
  const input = inputData(options);
  const expected = readProductSdkIdentityModule(createProductSdkIdentityModule({ schema: 1,
    kind: 'lawoss-product-sdk-packaging', mode: input.expectedMode === 'development' ? 'development' : 'without-sdk', target: input.target, applicationBuild: input.applicationBuild, sdk: null }));
  if (!['sdk', 'without-sdk', 'development'].includes(input.expectedMode)) invalid();
  const binding = { resourcesRoot: input.resourcesRoot, target: expected.target,
    expectedMode: input.expectedMode, applicationBuild: expected.applicationBuild };
  const resourceIdentity = await physical(input.resourcesRoot);
  const identity = await readPackagedProductSdkIdentity(binding);
  await publicBuild(input.resourcesRoot, expected.applicationBuild);
  const resourceRoot = path.join(input.resourcesRoot, 'plugin-sdk');
  let workspace, parentIdentity, owner;
  if (input.expectedMode !== 'sdk') {
    if (!await absent(resourceRoot)) invalid();
  } else {
    const validationParent = input.validationParent;
    parentIdentity = await workspaceIdentity(validationParent);
    if (inside(input.resourcesRoot, validationParent) || inside(validationParent, input.resourcesRoot)) invalid();
    workspace = path.join(validationParent, 'verification');
    if (!await absent(workspace)) invalid();
    await workspaceIdentity(validationParent, parentIdentity);
    await initialize(workspace);
    await workspaceIdentity(validationParent, parentIdentity);
    owner = await workspaceIdentity(workspace);
    const verified = await extractAndVerifyProductSdkCapsule({ resourceRoot, identity: identity.sdk, workspace });
    if (verified.status !== 'verified' || verified.payloadRoot !== path.join(workspace, 'payload') ||
      canonical(verified.identity) !== canonical(identity.sdk)) invalid();
  }
  const finalIdentity = await readPackagedProductSdkIdentity(binding);
  await publicBuild(input.resourcesRoot, expected.applicationBuild);
  if (canonical(identity) !== canonical(finalIdentity) || !same(resourceIdentity, await physical(input.resourcesRoot))) invalid();
  if (workspace) {
    await workspaceIdentity(input.validationParent, parentIdentity);
    await workspaceIdentity(workspace, owner);
    if (!await absent(path.join(workspace, '.admit-payload'))) invalid();
    // A single removal of the captured owned child only. Failure is retained;
    // there is no broad parent deletion, repair, retry or success on uncertainty.
    await rm(workspace, { recursive: true, force: false, maxRetries: 0 });
    await workspaceIdentity(input.validationParent, parentIdentity);
    if (!await absent(workspace)) invalid();
  } else if (!await absent(resourceRoot)) invalid();
  return Object.freeze({ status: identity.mode === 'development' ? 'development' : 'verified', mode: identity.mode, target: expected.target, applicationBuild: expected.applicationBuild,
    ...(identity.mode === 'sdk' ? { manifestSha256: identity.sdk.manifestSha256, capsuleSha256: identity.sdk.capsule.sha256 } : {}) });
}
