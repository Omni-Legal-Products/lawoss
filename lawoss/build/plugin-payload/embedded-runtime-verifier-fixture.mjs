import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as validation from './validate.mjs';

export const metadata = {
  acceptedInputText: await readFile(new URL('./sdk/package.json', import.meta.url), 'utf8'),
  acceptedLockText: await readFile(new URL('./sdk/package-lock.json', import.meta.url), 'utf8'),
};
export const hostTarget = { platform: process.platform, arch: process.arch,
  ...(process.platform === 'linux' ? { libc: process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl' } : {}) };

export async function owned(t) {
  const base = new URL('./.work/test-fixtures/', import.meta.url);
  await mkdir(base, { recursive: true });
  const root = await realpath(await mkdtemp(path.join(await realpath(base), 'embedded-verifier-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

// Format/byte fixture only. No SDK code is imported and probe metadata is not a
// native execution or compatibility claim.
export async function fixture(t) {
  const base = await owned(t), root = path.join(base, 'payload');
  await mkdir(root);
  const files = new Map([
    ['package.json', metadata.acceptedInputText], ['package-lock.json', metadata.acceptedLockText],
    ['node_modules/@opencode-ai/plugin/index.js', "throw Error('Inert SDK fixture must never execute');\n"],
  ]);
  for (const name of ['THIRD_PARTY_NOTICES.md', 'index.json', 'licenses/kubernetes-Apache-2.0.txt',
    'licenses/msgpackr-extract-MIT.txt', 'licenses/opencode-MIT.txt']) {
    files.set(`third-party-notices/${name}`, await readFile(new URL(`./sdk/notices/${name}`, import.meta.url)));
  }
  for (const [name, bytes] of files) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), bytes, { mode: 0o644 });
  }
  const manifest = { schema: 1, sdk: { name: '@opencode-ai/plugin', version: '1.18.29', integrity: validation.SDK_INTEGRITY },
    node: 'v24.21.0', arborist: '9.4.0', scripts: false, target: hostTarget,
    lockSha256: validation.sha256(metadata.acceptedLockText), inputSha256: validation.sha256(metadata.acceptedInputText),
    imports: { imports: validation.IMPORTS, native: validation.sdkConsumerMode(hostTarget, validation.SDK_LOCK_SHA256) === 'native-loaded' ? 'loaded' : 'fallback', guard: true, roundtrip: true },
    closure: Object.keys(JSON.parse(metadata.acceptedLockText).packages), inertOptional: [], licenses: [],
    files: await validation.inventory(root) };
  return { base, root, manifest };
}

export async function receipt(f) {
  const bytes = JSON.stringify(f.manifest);
  await writeFile(path.join(f.root, 'payload-manifest.json'), bytes);
  return validation.sha256(bytes);
}
