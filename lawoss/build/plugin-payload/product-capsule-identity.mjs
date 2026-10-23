import { SDK_LOCK_SHA256, sdkConsumerMode } from './validate.mjs';

const MiB = 1024 * 1024;
const bad = (code = 'PRODUCT_SDK_CAPSULE_INVALID') => { throw Object.assign(new Error(code), { code }); };
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function fields(value, names) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) bad();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some(key => !names.includes(key))) bad();
  return Object.fromEntries(names.map(name => {
    const field = descriptors[name];
    if (!field || !Object.hasOwn(field, 'value') || !field.enumerable) bad();
    return [name, field.value];
  }));
}
export function admitProductSdkCapsuleIdentity(value) {
  const result = fields(value, ['schema', 'kind', 'status', 'manifestSha256', 'target', 'lockSha256',
    'inputSha256', 'sourceSetSha256', 'consumerMode', 'verifierSha256', 'capsule']);
  const platform = result.target && Object.getOwnPropertyDescriptor(result.target, 'platform')?.value;
  result.target = Object.freeze(fields(result.target, platform === 'linux' ? ['platform', 'arch', 'libc'] : ['platform', 'arch']));
  result.capsule = Object.freeze(fields(result.capsule, ['format', 'file', 'sha256', 'bytes']));
  if (result.schema !== 1 || result.kind !== 'lawoss-product-sdk-capsule' || result.status !== 'verified' ||
    !['manifestSha256', 'inputSha256', 'sourceSetSha256', 'verifierSha256'].every(name => hex(result[name])) ||
    result.lockSha256 !== SDK_LOCK_SHA256 || sdkConsumerMode(result.target, result.lockSha256) !== result.consumerMode ||
    result.capsule.format !== 'tar+gzip' || result.capsule.file !== 'payload.tgz' || !hex(result.capsule.sha256) ||
    !Number.isSafeInteger(result.capsule.bytes) || result.capsule.bytes < 1 || result.capsule.bytes > 270 * MiB) bad();
  return Object.freeze(result);
}
