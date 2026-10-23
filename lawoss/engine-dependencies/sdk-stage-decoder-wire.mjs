// Closed data transport only; correlation is not launch/code authentication.
import { canonical } from '../build/plugin-payload/validate.mjs';

const invalid = () => { throw Object.assign(new Error('STAGE_REQUEST_INVALID'), { code: 'STAGE_REQUEST_INVALID' }); };
const codes = new Set(['STAGE_REQUEST_INVALID', 'STAGE_RUNTIME_UNSUPPORTED', 'STAGE_TARGET_MISMATCH',
  'STAGE_ABORTED', 'STAGE_DEADLINE', 'STAGE_RESOURCE_INVALID', 'STAGE_OWNERSHIP_UNCERTAIN',
  'STAGE_COPY_FAILED', 'STAGE_EXTRACT_FAILED', 'STAGE_VERIFY_FAILED', 'STAGE_HANDLE_CLOSE_FAILED',
  'STAGE_CLEANUP_UNCERTAIN', 'PRODUCT_SDK_CAPSULE_INVALID', 'PRODUCT_SDK_CAPSULE_LIMIT']);
const nonce = value => value === null || (typeof value === 'string' && /^[a-f0-9]{32}$/.test(value));
function cap(mode) { if (mode === 'request') return 32768; if (mode === 'terminal') return 4096; invalid(); }

// Never invoke getters/toJSON while encoding caller-supplied data. The transport
// subset is finite; request/result business predicates remain in accepted A.
function data(value, limit) {
  let count = 0, bytes = 0;
  function string(value) { bytes += Buffer.byteLength(value); if (bytes > limit) invalid(); }
  function visit(value, depth) {
    if (++count > 256 || depth > 8) invalid();
    if (typeof value === 'string') { string(value); return value; }
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
    if (!value || typeof value !== 'object') invalid();
    const array = Array.isArray(value);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.length > 256) invalid();
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 255 || keys.length !== length + 1) invalid();
      return Array.from({ length }, (_, i) => {
        const field = descriptors[String(i)];
        if (!field?.enumerable || !Object.hasOwn(field, 'value')) invalid();
        return visit(field.value, depth + 1);
      });
    }
    const result = Object.create(null);
    for (const key of keys) {
      const field = descriptors[key];
      if (typeof key !== 'string' || !field.enumerable || !Object.hasOwn(field, 'value')) invalid();
      string(key);
      Object.defineProperty(result, key, { value: visit(field.value, depth + 1), enumerable: true });
    }
    return result;
  }
  return visit(value, 0);
}

export function encodeStageWireFrame(value, mode) {
  const limit = cap(mode);
  let text;
  try { text = canonical(data(value, limit)); } catch { invalid(); }
  const length = Buffer.byteLength(text);
  if (length < 1 || length > limit) invalid();
  const frame = Buffer.allocUnsafe(4 + length);
  frame.writeUInt32BE(length); frame.write(text, 4, length, 'utf8');
  return frame;
}

export function createStageWireDecoder(mode) {
  const limit = cap(mode), header = Buffer.alloc(4);
  let headerBytes = 0, body, bodyBytes = 0, failed = false, finished = false;
  function refuse() { failed = true; body = undefined; invalid(); }
  return Object.freeze({
    push(chunk) {
      if (failed || finished || !Buffer.isBuffer(chunk)) refuse();
      let offset = 0;
      if (headerBytes < 4) {
        const n = Math.min(4 - headerBytes, chunk.length);
        chunk.copy(header, headerBytes, 0, n); headerBytes += n; offset += n;
        if (headerBytes === 4) {
          const length = header.readUInt32BE();
          if (length < 1 || length > limit) refuse();
          body = Buffer.allocUnsafe(length);
        }
      }
      if (body) {
        const n = Math.min(body.length - bodyBytes, chunk.length - offset);
        chunk.copy(body, bodyBytes, offset, offset + n); bodyBytes += n; offset += n;
      }
      if (offset !== chunk.length) refuse();
    },
    finish() {
      if (failed || finished || !body || bodyBytes !== body.length) refuse();
      finished = true;
      try {
        if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) refuse();
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
        const value = JSON.parse(text);
        if (canonical(value) !== text) refuse();
        body = undefined;
        return value;
      } catch { refuse(); }
    },
  });
}

export function admitStageError(value, expectedGeneration) {
  try {
    if (!nonce(expectedGeneration) || !value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    const fields = Object.getOwnPropertyDescriptors(value), names = ['schema', 'kind', 'generation', 'code'];
    if (Reflect.ownKeys(fields).length !== names.length || names.some(name => !fields[name]?.enumerable || !Object.hasOwn(fields[name], 'value'))) invalid();
    const schema = fields.schema.value, kind = fields.kind.value, generation = fields.generation.value, code = fields.code.value;
    if (schema !== 1 || kind !== 'lawoss-sdk-stage-error' || generation !== expectedGeneration || typeof code !== 'string' || !codes.has(code)) invalid();
    return Object.freeze({ schema, kind, generation, code });
  } catch { invalid(); }
}

export function projectStageError(error, admittedGeneration) {
  try {
    if (!nonce(admittedGeneration)) return undefined;
    const code = Object.getOwnPropertyDescriptor(error ?? {}, 'code')?.value;
    if (typeof code !== 'string' || !codes.has(code)) return undefined;
    return Object.freeze({ schema: 1, kind: 'lawoss-sdk-stage-error', generation: admittedGeneration, code });
  } catch { return undefined; }
}
