// Build-only archive of an already admitted SDK, inside the publisher's owned
// stage. This is not an extractor/admission API for untrusted runtime archives.
import { createReadStream } from 'node:fs';
import { lstat, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { canonical, inventory, verifyBuildPayload, withBuildFailureContext } from './validate.mjs';

export async function createProductSdkCapsule(stage, bundle, onFailure) {
  const payload = path.join(stage, 'payload');
  const originalFailure = withBuildFailureContext(onFailure, 'capsule-original');
  const roundtripFailure = withBuildFailureContext(onFailure, 'capsule-roundtrip');
  await verifyBuildPayload(payload, bundle.manifestSha256, bundle.target, originalFailure);
  const before = await inventory(payload, originalFailure);
  // Use the existing exact tools lock, resolving through its direct Arborist
  // dependency under pnpm isolation. Default directory publication loads none.
  const require = createRequire(new URL('./tools/package.json', import.meta.url));
  const arboristRequire = createRequire(require.resolve('@npmcli/arborist/package.json'));
  if (arboristRequire('tar/package.json').version !== '7.5.22') throw new Error('SDK_CAPSULE_TOOLS_INVALID');
  const tar = arboristRequire('tar');
  const archive = path.join(stage, 'payload.tgz');
  await tar.c({ cwd: payload, file: archive, gzip: true, portable: true, noMtime: true,
    follow: false, strict: true }, ['.']);
  const stat = await lstat(archive);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > 270 * 1024 * 1024) {
    throw new Error('SDK_CAPSULE_INVALID');
  }
  // Independently re-read the produced transport before removing the expanded
  // copy. Full SDK inventory verifies bytes, safe links and executable flags.
  const roundtrip = path.join(stage, '.capsule-roundtrip');
  await mkdir(roundtrip);
  await tar.x({ file: archive, cwd: roundtrip, strict: true, umask: 0 });
  await verifyBuildPayload(roundtrip, bundle.manifestSha256, bundle.target, roundtripFailure);
  if (canonical(await inventory(roundtrip, roundtripFailure)) !== canonical(before) ||
      canonical(await inventory(payload, originalFailure)) !== canonical(before)) throw new Error('SDK_CAPSULE_INVALID');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(archive)) digest.update(chunk);
  const after = await lstat(archive);
  if (after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
    throw new Error('SDK_CAPSULE_INVALID');
  }
  await rm(roundtrip, { recursive: true });
  await rm(payload, { recursive: true });
  return Object.freeze({ format: 'tar+gzip', file: 'payload.tgz', sha256: digest.digest('hex'), bytes: stat.size });
}
