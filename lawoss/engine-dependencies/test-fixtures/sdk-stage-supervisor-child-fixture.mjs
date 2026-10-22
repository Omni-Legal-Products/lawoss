// Trusted test composition only. A generated static wrapper selects one fixed
// inert function; no production request, argv, or environment selects behavior.
import { createStageWireDecoder, encodeStageWireFrame } from '../sdk-stage-decoder-wire.mjs';
const result = r => ({ schema: 1, kind: 'lawoss-sdk-stage-result', status: 'verified-stage', generation: r.generation,
  stageIdentity: r.stageGrant.identity, capsuleSha256: r.sdkIdentity.capsule.sha256,
  manifestSha256: r.sdkIdentity.manifestSha256, verifierSha256: r.sdkIdentity.verifierSha256 });
const request = async () => {
  const parser = createStageWireDecoder('request');
  for await (const bytes of process.stdin) parser.push(bytes);
  return parser.finish();
};
export async function holdReply() {
  const r = await request(); process.stdout.end(encodeStageWireFrame(result(r), 'terminal'));
  const timer = setInterval(() => {}, 1000);
  process.once('SIGUSR2', () => { clearInterval(timer); });
}
export async function blocked() {
  await request();
  process.stderr.write('READY', () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); });
}
export async function partial() { await request(); process.stdout.end(Buffer.from([0, 0, 0])); }
export async function extra() { const r = await request(); process.stdout.end(Buffer.concat([encodeStageWireFrame(result(r), 'terminal'), Buffer.from('x')])); }
export async function duplicate() { const r = await request(), frame = encodeStageWireFrame(result(r), 'terminal'); process.stdout.end(Buffer.concat([frame, frame])); }
export async function badNonce() { const r = await request(); process.stdout.end(encodeStageWireFrame({ ...result(r), generation: 'b'.repeat(32) }, 'terminal')); }
export async function late() { const r = await request(); setTimeout(() => process.stdout.end(encodeStageWireFrame(result(r), 'terminal')), 300); }
export async function declared() { await request(); process.stdout.write(Buffer.from([0, 0, 16, 1])); setInterval(() => {}, 1000); }
export async function flood() { await request(); process.stdout.write(Buffer.alloc(8192)); setInterval(() => {}, 1000); }
export async function stderrOverflow() { await request(); process.stderr.write(Buffer.alloc(16385)); setInterval(() => {}, 1000); }
export async function nonzero() { const r = await request(); process.stdout.end(encodeStageWireFrame(result(r), 'terminal')); process.exitCode = 1; }
export async function noResult() { await request(); }
export async function signalExit() { const r = await request(); process.stdout.end(encodeStageWireFrame(result(r), 'terminal'), () => process.kill(process.pid, 'SIGTERM')); }
export async function childError() { const r = await request(); process.stdout.end(encodeStageWireFrame({ schema: 1, kind: 'lawoss-sdk-stage-error', generation: r.generation, code: 'STAGE_VERIFY_FAILED' }, 'terminal')); process.exitCode = 1; }
export async function errorExitZero() { const r = await request(); process.stdout.end(encodeStageWireFrame({ schema: 1, kind: 'lawoss-sdk-stage-error', generation: r.generation, code: 'STAGE_ABORTED' }, 'terminal')); }
export async function rejectInput() { process.stdin.destroy(); process.exitCode = 1; }
export async function success() { const r = await request(); process.stdout.end(encodeStageWireFrame(result(r), 'terminal')); }
