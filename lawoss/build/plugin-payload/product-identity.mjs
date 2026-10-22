// Private build-code format, not an adjacent resource manifest or SDK authority.
// Its consumer must authenticate the containing application code independently.
import { validateBuildInfo } from '../../../apps/desktop/electron/build-info.mjs';
import { canonical, sdkConsumerMode, SDK_LOCK_SHA256 } from './validate.mjs';

const invalid = () => { throw Object.assign(new Error('PRODUCT_SDK_IDENTITY_INVALID'), { code: 'PRODUCT_SDK_IDENTITY_INVALID' }); };
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const shape = (value, keys) => {
  if (!value || typeof value !== 'object' || canonical(Object.keys(value).sort()) !== canonical([...keys].sort())) invalid();
};
function snapshot(value, depth = 0, budget = { values: 0, text: 0, active: new WeakSet() }) {
  if (++budget.values > 256 || depth > 5) invalid();
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (typeof value === 'string') {
    if (value.length > 4096 || (budget.text += value.length) > 16384) invalid();
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || budget.active.has(value)) invalid();
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  if (keys.length > 16 || keys.some(key => typeof key !== 'string')) invalid();
  budget.active.add(value);
  const result = {};
  // The preceding own-key guard has already refused every symbol.
  for (const key of /** @type {string[]} */ (keys)) {
    const field = fields[key];
    if (!field.enumerable || !Object.hasOwn(field, 'value') || (budget.text += key.length) > 16384) invalid();
    Object.defineProperty(result, key, { enumerable: true, value: snapshot(field.value, depth + 1, budget) });
  }
  budget.active.delete(value);
  return Object.freeze(result);
}
function admit(input) {
  try {
    const value = snapshot(input);
    shape(value, ['schema', 'kind', 'mode', 'applicationBuild', 'target', 'sdk']);
    if (value.schema !== 1 || value.kind !== 'lawoss-product-sdk-packaging' || !['sdk', 'without-sdk', 'development'].includes(value.mode)) invalid();
    const mode = sdkConsumerMode(value.target, SDK_LOCK_SHA256);
    if (value.mode === 'development') {
      if (value.applicationBuild !== null || value.sdk !== null) invalid();
      return value;
    }
    validateBuildInfo(value.applicationBuild);
    if (value.applicationBuild.platform !== value.target.platform || value.applicationBuild.arch !== value.target.arch) invalid();
    if (value.mode === 'without-sdk') { if (value.sdk !== null) invalid(); return value; }
    const sdk = value.sdk;
    shape(sdk, ['schema', 'kind', 'status', 'manifestSha256', 'target', 'lockSha256', 'inputSha256', 'sourceSetSha256', 'consumerMode', 'verifierSha256', 'capsule']);
    if (sdk.schema !== 1 || sdk.kind !== 'lawoss-product-sdk-capsule' || sdk.status !== 'verified' ||
      canonical(sdk.target) !== canonical(value.target) || sdk.lockSha256 !== SDK_LOCK_SHA256 || sdk.consumerMode !== mode ||
      !['manifestSha256', 'inputSha256', 'sourceSetSha256', 'verifierSha256'].every(key => hex(sdk[key]))) invalid();
    shape(sdk.capsule, ['format', 'file', 'sha256', 'bytes']);
    if (sdk.capsule.format !== 'tar+gzip' || sdk.capsule.file !== 'payload.tgz' || !hex(sdk.capsule.sha256) ||
      !Number.isSafeInteger(sdk.capsule.bytes) || sdk.capsule.bytes < 1 || sdk.capsule.bytes > 270 * 1024 * 1024) invalid();
    return value;
  } catch { invalid(); }
}
const prefix = '// Generated private LAWOSS SDK packaging identity.\nconst identity = ';
const suffix = ';\nObject.freeze(identity.applicationBuild);\nObject.freeze(identity.target);\nif (identity.sdk) {\n  Object.freeze(identity.sdk.target);\n  Object.freeze(identity.sdk.capsule);\n  Object.freeze(identity.sdk);\n}\nexport default Object.freeze(identity);\n';

export function createProductSdkIdentityModule(input) {
  return prefix + JSON.stringify(admit(input)) + suffix;
}

/** Parse the closed generated format as data, without importing/evaluating it. */
export function readProductSdkIdentityModule(text) {
  try {
    if (typeof text !== 'string' || text.length > 65536 || !text.startsWith(prefix) || !text.endsWith(suffix)) invalid();
    const value = admit(JSON.parse(text.slice(prefix.length, -suffix.length)));
    if (createProductSdkIdentityModule(value) !== text) invalid();
    return value;
  } catch { invalid(); }
}
