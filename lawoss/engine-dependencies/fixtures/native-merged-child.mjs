// Controlled direct-child settlement fixture. No descendants or network.
import fs from 'node:fs/promises';
import path from 'node:path';
const [mode, workspace] = process.argv.slice(2);
async function finalWrite() {
  await new Promise(resolve => setTimeout(resolve, 20));
  await fs.writeFile(path.join(workspace, 'settled'), 'closed-before-cleanup');
}
if (['projection-held', 'projection-nonzero', 'projection-failure', 'projection-forged-code', 'projection-output-limit', 'acquisition-held'].includes(mode)) {
  // A schema-shaped negative receipt is visible while this real process lives.
  // Readiness follows handler installation and flushed stdout, never a sleep.
  let released = false;
  process.once('SIGTERM', () => { released = true; });
  let receipt;
  if (mode === 'acquisition-held') {
    const { ACCEPTED } = await import('../../build/plugin-payload/prime-cache.mjs');
    const { RUNTIME_LOCK, VERSIONS } = await import('../native-merged-cache-worker.mjs');
    // Schema-shaped acquisition control only, not genuine acquired cache proof.
    receipt = JSON.stringify({ schema: 1, phase: 'acquisition', status: 'complete', ...ACCEPTED, runtimeLockSha256: RUNTIME_LOCK,
      node: process.version, platform: process.platform, versions: VERSIONS, tarballs: 32, names: 32, metadata: 64, offline: 64, archiveBytes: 1, metadataBytes: 1 });
  } else receipt = await fs.readFile(path.join(workspace, 'projection-fixture-receipt.json'), 'utf8');
  await new Promise((resolve, reject) => process.stdout.write(receipt + '\n', error => error ? reject(error) : resolve()));
  await fs.writeFile(path.join(workspace, 'projection-ready'), 'handler-installed-and-receipt-flushed');
  if (mode === 'projection-output-limit') {
    while (!released && !(await fs.stat(path.join(workspace, 'projection-output-release')).catch(() => null))) await new Promise(resolve => setTimeout(resolve, 5));
    if (!released) process.stdout.write('x'.repeat(70000));
  }
  while (!released && !(await fs.stat(path.join(workspace, 'projection-release')).catch(() => null))) await new Promise(resolve => setTimeout(resolve, 5));
  await fs.writeFile(path.join(workspace, 'projection-final'), 'child-final-write');
  if (mode === 'projection-failure' || mode === 'projection-output-limit') {
    await fs.writeFile(path.join(workspace, 'native-projection-operation.json'), await fs.readFile(path.join(workspace, 'projection-fixture-failure.json')));
    console.error('private-sentinel'); console.error(JSON.stringify({ code: 'TOOLS_INVALID' })); process.exitCode = 1;
  } else if (mode === 'projection-forged-code') { console.error(JSON.stringify({ code: 'TOOLS_INVALID' })); process.exitCode = 1; }
  else if (mode === 'projection-nonzero') { console.error(JSON.stringify({ code: 'SECRET_TOKEN' })); process.exitCode = 1; }
} else if (mode === 'worker-receipt') {
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
