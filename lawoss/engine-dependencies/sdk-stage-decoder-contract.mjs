// Stage-only data admission. These records describe an externally owned grant;
// parsing them does not mint filesystem or publication authority.
import path from 'node:path';
import { admitProductSdkCapsuleIdentity } from '../build/plugin-payload/product-capsule-identity.mjs';

const invalid = () => { throw Object.assign(new Error('STAGE_REQUEST_INVALID'), { code: 'STAGE_REQUEST_INVALID' }); };
const decimal = (value, nonzero = false) => typeof value === 'string' && /^(?:0|[1-9][0-9]{0,39})$/.test(value) && (!nonzero || value !== '0');
function snapshot(value) {
  let values = 0, bytes = 0;
  const active = new Set();
  function string(value) { bytes += Buffer.byteLength(value, 'utf8'); if (bytes > 32768) invalid(); }
  function visit(value, depth) {
    if (++values > 256 || depth > 8) invalid();
    if (typeof value === 'string') { string(value); return value; }
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || active.has(value)) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.length > 256) invalid();
    active.add(value);
    const result = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string') invalid();
      string(key);
      const field = descriptors[key];
      if (!field.enumerable || !Object.hasOwn(field, 'value')) invalid();
      Object.defineProperty(result, key, { value: visit(field.value, depth + 1), enumerable: true });
    }
    active.delete(value);
    return Object.freeze(result);
  }
  return visit(value, 0);
}
function fields(value, names) {
  if (!value || typeof value !== 'object' || Reflect.ownKeys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) invalid();
}
function identity(value) {
  fields(value, ['dev', 'ino']);
  if (!decimal(value.dev) || !decimal(value.ino, true)) invalid();
}
function root(value) {
  if (typeof value !== 'string' || value.length > 4096 || Buffer.byteLength(value, 'utf8') > 16384 || value.includes('\0') ||
    !path.isAbsolute(value) || path.normalize(value) !== value || path.resolve(value) !== value) invalid();
}
function requestData(value, checkExpiry) {
  const result = snapshot(value);
  fields(result, ['schema', 'kind', 'generation', 'resourceRoot', 'resourceIdentity', 'stageGrant', 'sdkIdentity', 'deadline']);
  if (result.schema !== 1 || result.kind !== 'lawoss-sdk-stage-decode' || typeof result.generation !== 'string' || !/^[a-f0-9]{32}$/.test(result.generation)) invalid();
  root(result.resourceRoot); identity(result.resourceIdentity);
  fields(result.stageGrant, ['path', 'identity', 'parent']);
  root(result.stageGrant.path); identity(result.stageGrant.identity);
  fields(result.stageGrant.parent, ['path', 'dev', 'ino']);
  root(result.stageGrant.parent.path);
  if (!decimal(result.stageGrant.parent.dev) || !decimal(result.stageGrant.parent.ino, true)) invalid();
  // Semantic SDK predicates have one implementation shared with the build gate.
  const sdkIdentity = admitProductSdkCapsuleIdentity(result.sdkIdentity);
  if (!Number.isSafeInteger(result.deadline)) invalid();
  if (checkExpiry) {
    const now = Date.now();
    if (result.deadline - now > 2 ** 31 - 1) invalid();
    if (result.deadline <= now) throw Object.assign(new Error('STAGE_DEADLINE'), { code: 'STAGE_DEADLINE' });
  }
  return Object.freeze({ ...result, sdkIdentity });
}
export function admitStageDecodeRequest(value) {
  try { return requestData(value, true); }
  catch (error) { if (Object.getOwnPropertyDescriptor(error ?? {}, 'code')?.value === 'STAGE_DEADLINE') throw error; invalid(); }
}
export function admitStageDecodeResult(value, admittedRequest) {
  try {
    const request = requestData(admittedRequest, false), result = snapshot(value);
    fields(result, ['schema', 'kind', 'status', 'generation', 'stageIdentity', 'capsuleSha256', 'manifestSha256', 'verifierSha256']);
    identity(result.stageIdentity);
    if (result.schema !== 1 || result.kind !== 'lawoss-sdk-stage-result' || result.status !== 'verified-stage' ||
      result.generation !== request.generation || result.stageIdentity.dev !== request.stageGrant.identity.dev || result.stageIdentity.ino !== request.stageGrant.identity.ino ||
      result.capsuleSha256 !== request.sdkIdentity.capsule.sha256 || result.manifestSha256 !== request.sdkIdentity.manifestSha256 || result.verifierSha256 !== request.sdkIdentity.verifierSha256) invalid();
    return Object.freeze({ ...result, stageIdentity: Object.freeze({ ...result.stageIdentity }) });
  } catch { invalid(); }
}
