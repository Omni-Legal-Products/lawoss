// Build-only publication under a caller-controlled, exclusively owned directory.
// The lease coordinates this API, not arbitrary same-UID writers. Node rename
// has no directory no-replace primitive: the final absence check has that gap.
// Windows UID/mode fields do not establish ACL privacy; caller ownership there
// remains an explicit build-boundary precondition. No SDK code is executed.
import { cp, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectProductSdkBundle } from './product-bundle.mjs';
import { createProductSdkCapsule } from './product-capsule.mjs';
import { canonical, inventory, sha256, verifyBuildPayload } from './validate.mjs';

const closure = ['validate.mjs', 'notices.mjs', 'sdk/package.json', 'sdk/package-lock.json',
  'sdk/notices/index.json', 'sdk/notices/THIRD_PARTY_NOTICES.md',
  'sdk/notices/licenses/opencode-MIT.txt', 'sdk/notices/licenses/msgpackr-extract-MIT.txt',
  'sdk/notices/licenses/kubernetes-Apache-2.0.txt'];
const invalid = () => { throw Object.assign(new Error('PRODUCT_SDK_RESOURCE_INVALID'), { code: 'PRODUCT_SDK_RESOURCE_INVALID' }); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const inside = (a, b) => {
  const relative = path.relative(a, b);
  return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
async function absent(file) {
  try { await lstat(file); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
async function directory(root) {
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root ||
    (typeof process.getuid === 'function' && (stat.uid !== process.getuid() || (stat.mode & 0o077)))) invalid();
  return stat;
}
async function unchanged(root, identity) {
  if (!same(await directory(root), identity)) invalid();
}
async function removeStage(stage, identity) {
  await unchanged(stage, identity);
  await rm(stage, { recursive: true });
}

/** Returns private code identity as text; publication alone grants no runtime authority. */
export async function publishProductSdkResource(options) {
  const { buildParent, outputName, payloadRoot, transport = 'directory' } = options;
  if (!['directory', 'tar+gzip'].includes(transport) ||
    typeof buildParent !== 'string' || !path.isAbsolute(buildParent) || path.resolve(buildParent) !== buildParent || buildParent.length > 4096 ||
    typeof outputName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(outputName) ||
    typeof payloadRoot !== 'string' || !path.isAbsolute(payloadRoot) ||
    inside(payloadRoot, buildParent) || inside(buildParent, payloadRoot)) invalid();
  const parent = await directory(buildParent), destination = path.join(buildParent, outputName);
  if (!await absent(destination)) invalid();
  // The complete trusted S1 contract is evaluated before any copy or stage.
  const admission = { ...options, payloadRoot };
  const bundle = await inspectProductSdkBundle(admission);
  const source = await lstat(payloadRoot);
  const contents = [];
  for (const name of closure) {
    const file = fileURLToPath(new URL(name, import.meta.url)), stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024) invalid();
    const bytes = await readFile(file);
    if (bytes.length !== stat.size) invalid();
    contents.push([name, bytes, stat.mode & 0o777]);
  }
  const leasePath = path.join(buildParent, '.lawoss-plugin-sdk-publication.lock');
  const lease = await open(leasePath, 'wx', 0o600);
  let leaseIdentity;
  let stage, stageIdentity, publishing = false, primary, failed = false;
  try {
    leaseIdentity = await lease.stat();
    await unchanged(buildParent, parent);
    if (!await absent(destination)) invalid();
    stage = await mkdtemp(path.join(buildParent, '.plugin-sdk-stage-'));
    stageIdentity = await directory(stage);
    await cp(payloadRoot, path.join(stage, 'payload'), { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
    const verifier = path.join(stage, 'verifier');
    await mkdir(verifier);
    for (const [name, bytes, mode] of contents) {
      await mkdir(path.dirname(path.join(verifier, name)), { recursive: true });
      await writeFile(path.join(verifier, name), bytes, { flag: 'wx', mode });
    }
    const verified = await inspectProductSdkBundle({ ...admission, payloadRoot: path.join(stage, 'payload') });
    if (canonical(verified) !== canonical(bundle)) invalid();
    const expectedVerifier = contents.map(([name, bytes, mode]) => ({ path: name, bytes: bytes.length,
      executable: !!(mode & 0o111), sha256: sha256(bytes) })).sort((a, b) => a.path < b.path ? -1 : 1);
    const verifierFiles = await inventory(verifier);
    if (canonical(verifierFiles) !== canonical(expectedVerifier)) invalid();
    await verifyBuildPayload(path.join(stage, 'payload'), bundle.manifestSha256, bundle.target);
    const capsule = transport === 'tar+gzip' ? await createProductSdkCapsule(stage, bundle) : null;
    // Re-read source admission and verifier inputs after copying, before rename.
    if (!same(source, await lstat(payloadRoot)) || canonical(await inspectProductSdkBundle(admission)) !== canonical(bundle)) invalid();
    for (const [name, bytes] of contents) if (!bytes.equals(await readFile(new URL(name, import.meta.url)))) invalid();
    await unchanged(buildParent, parent);
    await unchanged(stage, stageIdentity);
    if (!await absent(destination)) invalid();
    const identity = Object.freeze({ ...bundle, kind: capsule ? 'lawoss-product-sdk-capsule' : 'lawoss-product-sdk-resource',
      verifierSha256: sha256(canonical(verifierFiles)), ...(capsule ? { capsule } : {}) });
    const privateIdentityModule = `// Generated private build identity; include inside trusted application code.\nconst identity = ${JSON.stringify(identity)};\nObject.freeze(identity.target);\n${capsule ? 'Object.freeze(identity.capsule);\n' : ''}export default Object.freeze(identity);\n`;
    publishing = true;
    await rename(stage, destination);
    if (!same(stageIdentity, await lstat(destination))) invalid();
    return Object.freeze({ resourceRoot: destination, identity, privateIdentityModule });
  } catch (error) { primary = error; failed = true; throw error; }
  finally {
    const cleanup = [];
    // Once rename starts, retain ambiguous output/stage instead of guessing.
    if (stage && stageIdentity && !publishing) {
      try { await removeStage(stage, stageIdentity); } catch (error) { cleanup.push(error); }
    }
    try {
      await lease.close();
      // Missing identity (for example fstat failure) retains the unbound marker.
      if (leaseIdentity) {
        if (!same(leaseIdentity, await lstat(leasePath))) invalid();
        await unlink(leasePath);
      }
    } catch (error) { cleanup.push(error); try { await lease.close(); } catch {} }
    if (cleanup.length) {
      if (failed) throw new AggregateError([primary, ...cleanup], 'SDK resource publication and cleanup failed', { cause: primary });
      throw new AggregateError(cleanup, 'SDK resource publication cleanup failed');
    }
  }
}
