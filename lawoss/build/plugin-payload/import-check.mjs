// Isolated host imports only: never construct a client, engine, provider or TUI.
import { createRequire } from 'node:module';
import path from 'node:path';
if (globalThis[Symbol.for('lawoss.payload.networkDisabled')] !== true) {
  console.error(JSON.stringify({ code: 'GUARD_NOT_ADMITTED' })); process.exit(1);
}
const root = process.argv[2];
const require = createRequire(path.join(root, 'package.json'));
const specs = [
  '@opencode-ai/plugin', '@opencode-ai/plugin/tool',
  '@opencode-ai/plugin/v2/effect', '@opencode-ai/plugin/v2/promise',
  '@opencode-ai/plugin/v2/effect/plugin', '@opencode-ai/plugin/v2/effect/integration',
  'zod', 'effect', '@ai-sdk/provider', '@opencode-ai/sdk',
];
for (const spec of specs) {
  try { await import(spec); }
  catch (error) { console.error(JSON.stringify({ code: /^[A-Z_]{1,40}$/.test(error.code) ? error.code : 'IMPORT_FAILED' })); process.exit(1); }
}
// Observe prebuilt native load separately from msgpackr's ordinary fallback path.
let native = 'absent';
let roundtrip = false;
try {
  const msgpackr = require('msgpackr');
  const decoded = msgpackr.unpack(msgpackr.pack({ fixture: 'sdk-payload' }));
  if (decoded.fixture !== 'sdk-payload') throw Error('ROUNDTRIP_FAILED');
  roundtrip = true;
  try { const extract = require('msgpackr-extract'); native = typeof extract.extractStrings === 'function' && msgpackr.isNativeAccelerationEnabled === true ? 'loaded' : 'fallback'; }
  catch { native = 'fallback'; }
} catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
console.log(JSON.stringify({ imports: specs, native, guard: true, roundtrip }));
