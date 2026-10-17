// Synthetic wire-protocol peer, NOT the compiled engine or Effect runtime.
// Protocol: opencode 16747470f976aca3d362ad730bcd3fe82ecc2c9a util/flock.ts.
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import path from 'node:path';
const [state, logical] = process.argv.slice(2);
const dir = path.join(state, 'locks', createHash('sha1').update(`npm-install:${logical}`).digest('hex') + '.lock');
const token = randomUUID();
await fs.mkdir(path.dirname(dir), { recursive: true });
await fs.mkdir(dir, { mode: 0o700 });
await fs.writeFile(path.join(dir, 'heartbeat'), '', { flag: 'wx' });
await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ token, pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString() }), { flag: 'wx' });
process.on('message', async message => {
  if (message !== 'release') return;
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
  if (meta.token !== token) throw new Error('PEER_COMPROMISED');
  await fs.rm(dir, { recursive: true });
  process.send('released', () => process.disconnect());
});
process.send('ready');
