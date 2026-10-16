// Controlled direct-child settlement fixture. No descendants or network.
import fs from 'node:fs/promises';
import path from 'node:path';
const [mode, workspace] = process.argv.slice(2);
async function finalWrite() {
  await new Promise(resolve => setTimeout(resolve, 20));
  await fs.writeFile(path.join(workspace, 'settled'), 'closed-before-cleanup');
}
if (mode === 'cancel') {
  const hold = setInterval(() => {}, 1000);
  process.once('SIGTERM', async () => { clearInterval(hold); await finalWrite(); });
  await fs.writeFile(path.join(workspace, 'ready'), 'ready');
} else {
  await finalWrite();
  if (mode === 'failure') { console.error('private-sentinel'); process.exitCode = 1; }
  else console.log(JSON.stringify({ status: 'complete' }));
}
