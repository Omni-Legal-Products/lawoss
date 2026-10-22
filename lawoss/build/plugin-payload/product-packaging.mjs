// Build-only preparation. This does not install a product runtime hook or grant
// authority to an adjacent SDK summary; accepted suppliers are caller-trusted.
import { mkdir, lstat, realpath, writeFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { freshProductSdkBuildRoot, completeProductSdkBuildRoot, retainFailedProductSdkBuildRoot } from './product-build-root.mjs';
import { createProductSdkIdentityModule, readProductSdkIdentityModule } from './product-identity.mjs';
import { inspectProductSdkBundle } from './product-bundle.mjs';
import { publishProductSdkResource } from './product-resource.mjs';
import { childEnvironment, initialize } from './prepare.mjs';
import { canonical, SDK_LOCK_SHA256 } from './validate.mjs';

const error = code => Object.assign(new Error(code), { code });
const refuse = (code = 'PRODUCT_SDK_PACKAGING_INVALID') => { throw error(code); };
const parse = (text, code = 'PRODUCT_SDK_PACKAGING_INVALID') => {
  try { return JSON.parse(text); } catch { refuse(code); }
};
function fields(value, keys) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) refuse();
  const descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) refuse();
  const result = {};
  for (const key of keys) {
    const field = descriptors[key];
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) refuse();
    Object.defineProperty(result, key, { value: field.value, enumerable: true });
  }
  return result;
}
function data(value, depth = 0, budget = { values: 0, text: 0, active: new WeakSet() }) {
  if (++budget.values > 4096 || depth > 8) refuse();
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (typeof value === 'string') { if ((budget.text += value.length) > 65536) refuse(); return value; }
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || budget.active.has(value)) refuse();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length > 64 || keys.some(key => typeof key !== 'string')) refuse();
  budget.active.add(value);
  const result = {};
  for (const key of keys) {
    const field = descriptors[key];
    if (!field.enumerable || !Object.hasOwn(field, 'value') || (budget.text += key.length) > 65536) refuse();
    Object.defineProperty(result, key, { enumerable: true, value: data(field.value, depth + 1, budget) });
  }
  budget.active.delete(value);
  return Object.freeze(result);
}
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};
const entry = fileURLToPath(new URL('./runtime-consumer-validation.mjs', import.meta.url));
const unchanged = (a, b) => same(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
async function physicalFile(file, limit, retain = false) {
  if (typeof file !== 'string' || file.length > 4096 || !path.isAbsolute(file) || path.resolve(file) !== file) refuse();
  const before = await lstat(file);
  const regular = stat => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size > 0 && stat.size <= limit;
  if (!regular(before) || await realpath(file) !== file) refuse();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!regular(await handle.stat()) || !unchanged(before, await handle.stat())) refuse();
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536), chunks = [];
    let total = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, limit + 1 - total), null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) refuse();
      hash.update(buffer.subarray(0, bytesRead));
      if (retain) chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const after = await lstat(file);
    if (total !== before.size || !regular(after) || !unchanged(before, after) ||
      !unchanged(before, await handle.stat()) || await realpath(file) !== file) refuse();
    return { path: file, stat: before, limit, sha256: hash.digest('hex'), ...(retain ? { text: Buffer.concat(chunks).toString('utf8') } : {}) };
  } finally { await handle.close(); }
}
async function nativeInputs(supplier, initial, root) {
  if (initial.target.platform !== process.platform || initial.target.arch !== process.arch ||
    (process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime)) refuse('PRODUCT_SDK_NATIVE_TARGET_MISMATCH');
  if (process.version !== 'v24.21.0') refuse('PRODUCT_SDK_NATIVE_RUNTIME_INVALID');
  if (![supplier.headSha, supplier.checkoutSha].every(value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)) ||
    supplier.checkoutSha !== initial.applicationBuild.gitSha) refuse();
  for (const file of [supplier.consumerNode, supplier.pnpmCli]) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || inside(root, file) || inside(file, root)) refuse();
  }
  const consumer = await physicalFile(supplier.consumerNode, 256 * 1024 * 1024);
  const producer = await physicalFile(process.execPath, 256 * 1024 * 1024);
  const cli = await physicalFile(supplier.pnpmCli, 16 * 1024 * 1024);
  const packageRoot = path.dirname(path.dirname(cli.path));
  const pkg = await physicalFile(path.join(packageRoot, 'package.json'), 65536, true);
  const metadata = parse(pkg.text);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || metadata.name !== 'pnpm' || metadata.version !== '11.4.0' || metadata.bin?.pnpm !== 'bin/pnpm.mjs' ||
    cli.path !== path.join(packageRoot, 'bin/pnpm.mjs')) refuse();
  const script = await physicalFile(entry, 1024 * 1024);
  return { consumer, producer, cli, pkg, script };
}
function originalNativeChild(supplier, workspace) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, supplier.consumerNode, supplier.pnpmCli, '--output-parent', workspace], {
      cwd: workspace, env: { ...childEnvironment(workspace), LAWOSS_PR_HEAD: supplier.headSha, LAWOSS_CHECKOUT_SHA: supplier.checkoutSha },
      detached: process.platform !== 'win32', windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false, bytes = 0;
    const output = [];
    const stop = code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // This bounds this caller, not Windows descendant closure. Any ambiguous
      // child termination retains the whole generation and its outer marker.
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      reject(error(code));
    };
    const timer = setTimeout(() => stop('PRODUCT_SDK_NATIVE_CHILD_TIMEOUT'), 20 * 60 * 1000);
    child.on('error', () => stop('PRODUCT_SDK_NATIVE_CHILD_FAILED'));
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('error', () => stop('PRODUCT_SDK_NATIVE_CHILD_FAILED'));
      stream.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 65536) stop('PRODUCT_SDK_NATIVE_CHILD_OUTPUT_LIMIT');
        else if (stream === child.stdout && !settled) output.push(chunk);
      });
    }
    child.on('close', (code, signal) => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      if (code !== 0 || signal !== null) reject(error('PRODUCT_SDK_NATIVE_CHILD_FAILED'));
      else resolve(Buffer.concat(output).toString('utf8').trim());
    });
  });
}
async function nativeBundle(supplier, initial, workspace, inputs) {
  await initialize(workspace);
  const output = fields(parse(await originalNativeChild(supplier, workspace), 'PRODUCT_SDK_NATIVE_PROOF_INVALID'), ['status', 'stage', 'code']);
  if (output.status !== 'complete' || output.stage !== null || output.code !== null) refuse('PRODUCT_SDK_NATIVE_PROOF_INVALID');
  const summary = data(parse((await physicalFile(path.join(workspace, 'runtime-consumer-summary.json'), 65536, true)).text, 'PRODUCT_SDK_NATIVE_PROOF_INVALID'));
  if (summary.headSha !== supplier.headSha || summary.checkoutSha !== supplier.checkoutSha ||
    canonical(summary.target) !== canonical(initial.target) || summary.producer?.sha256 !== inputs.producer.sha256 ||
    summary.consumer?.sha256 !== inputs.consumer.sha256 || summary.sources?.['runtime-consumer-validation.mjs'] !== inputs.script.sha256) refuse('PRODUCT_SDK_NATIVE_PROOF_INVALID');
  for (const input of Object.values(inputs)) {
    const current = await physicalFile(input.path, input.limit);
    if (!unchanged(input.stat, current.stat) || current.sha256 !== input.sha256) refuse('PRODUCT_SDK_NATIVE_PROOF_INVALID');
  }
  return { payloadRoot: path.join(workspace, 'runtime-consumer-validation', 'payload'),
    expectedManifestSha256: summary.payloadManifestSha256, expectedTarget: initial.target,
    acceptedLockSha256: SDK_LOCK_SHA256, compatibilityBinding: summary };
}
async function physical(directory) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid())) refuse();
  return stat;
}

export async function prepareProductSdkPackaging(options) {
  const input = fields(options, ['desktopRoot', 'target', 'supplier', 'applicationBuild']);
  const initial = readProductSdkIdentityModule(createProductSdkIdentityModule({ schema: 1,
    kind: 'lawoss-product-sdk-packaging', mode: input.applicationBuild === null ? 'development' : 'without-sdk', applicationBuild: input.applicationBuild,
    target: input.target, sdk: null }));
  const supplier = data(input.supplier);
  if (supplier.mode === 'without-sdk') fields(supplier, ['mode']);
  else if (supplier.mode === 'accepted') fields(supplier, ['mode', 'payloadRoot', 'expectedManifestSha256', 'acceptedLockSha256', 'compatibilityBinding']);
  else if (supplier.mode === 'native') fields(supplier, ['mode', 'consumerNode', 'pnpmCli', 'headSha', 'checkoutSha']);
  else refuse();
  if (initial.mode === 'development' && supplier.mode !== 'without-sdk') refuse();
  const desktopRoot = input.desktopRoot;
  if (typeof desktopRoot !== 'string' || desktopRoot.length > 4096 || !path.isAbsolute(desktopRoot) || path.resolve(desktopRoot) !== desktopRoot) refuse();
  await physical(desktopRoot);
  const parent = path.join(desktopRoot, 'resources');
  const parentIdentity = await physical(parent), root = path.join(parent, '.plugin-sdk-build');
  let bundle, inputs;
  if (supplier.mode === 'accepted') {
    bundle = { payloadRoot: supplier.payloadRoot, expectedManifestSha256: supplier.expectedManifestSha256,
      acceptedLockSha256: supplier.acceptedLockSha256, compatibilityBinding: supplier.compatibilityBinding, expectedTarget: initial.target };
    await inspectProductSdkBundle(bundle);
    if (inside(root, supplier.payloadRoot) || inside(supplier.payloadRoot, root)) refuse();
  } else if (supplier.mode === 'native') inputs = await nativeInputs(supplier, initial, root);
  if (!same(parentIdentity, await physical(parent))) refuse();
  const generation = await freshProductSdkBuildRoot(root);
  // After generation admission, any failure intentionally retains its lease and
  // owned bytes. In particular, no failed supplier can become an idle generation.
  let completionStarted = false;
  try {
    let resourceRoot = null, identity = initial;
    if (inputs) bundle = await nativeBundle(supplier, initial, path.join(root, 'supplier'), inputs);
    if (bundle) {
      const buildParent = path.join(root, 'publication');
      await mkdir(buildParent, { mode: 0o700 });
      const published = await publishProductSdkResource({ ...bundle, buildParent, outputName: 'plugin-sdk', transport: 'tar+gzip' });
      resourceRoot = published.resourceRoot;
      identity = readProductSdkIdentityModule(createProductSdkIdentityModule({ ...initial, mode: 'sdk', sdk: published.identity }));
    }
    const applicationCodeRoot = path.join(generation.root, 'application-code');
    await mkdir(applicationCodeRoot, { mode: 0o700 });
    const identityModulePath = path.join(applicationCodeRoot, 'identity.mjs');
    await writeFile(identityModulePath, createProductSdkIdentityModule(identity), { flag: 'wx', mode: 0o600 });
    completionStarted = true; // Completion consumes and closes its capability even on failure.
    await completeProductSdkBuildRoot(generation);
    return Object.freeze({ applicationCodeRoot, identityModulePath, resourceRoot, identity });
  } catch (primary) {
    if (!completionStarted) {
      try { await retainFailedProductSdkBuildRoot(generation); }
      catch (cleanup) { throw new AggregateError([primary, cleanup], 'SDK packaging and generation close failed', { cause: primary }); }
    }
    throw primary;
  }
}
