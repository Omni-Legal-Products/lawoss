// Controlled direct-child settlement fixture. No descendants or network.
import fs from 'node:fs/promises';
import path from 'node:path';
const [mode, workspace] = process.argv.slice(2);
async function finalWrite() {
  await new Promise(resolve => setTimeout(resolve, 20));
  await fs.writeFile(path.join(workspace, 'settled'), 'closed-before-cleanup');
}
if (mode === 'worker-receipt') {
  const { writeOperationReceipt } = await import('../native-merged-cache-worker.mjs');
  await finalWrite();
  await writeOperationReceipt(workspace, { schema: 1, status: 'failed', stage: 'metadata', code: 'METADATA_DIST', tarballs: 32, metadata: 1, offline: 0 });
  console.error('private-sentinel'); console.error(JSON.stringify({ code: 'METADATA_DIST' })); process.exitCode = 1;
} else if (mode === 'failed-tap') {
  console.log('TAP version 13\nnot ok 1 - private-sentinel\n  ---\n  error: private-sentinel\n  ...\n1..1\n# tests 1\n# suites 0\n# pass 0\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0'); process.exitCode = 1;
} else if (mode === 'cancel') {
  const hold = setInterval(() => {}, 1000);
  process.once('SIGTERM', async () => { clearInterval(hold); await finalWrite(); });
  await fs.writeFile(path.join(workspace, 'ready'), 'ready');
} else {
  await finalWrite();
  if (mode === 'failure') { console.error('private-sentinel'); process.exitCode = 1; }
  else console.log(JSON.stringify({ status: 'complete' }));
}
