// Diagnostic-only owned fixture: distinguish a descendant directory watch from
// an external file owner. No server/profile paths or process IDs are emitted.
import { watch } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const root = await mkdtemp(join(tmpdir(), 'lawoss-owned-watch-rename-'));
let watcher;
try {
  const source = join(root, 'synthetic');
  const target = join(root, 'workflow-assistant-synthetic');
  const resource = join(source, 'resources');
  await mkdir(resource, { recursive: true });
  await writeFile(join(source, 'SKILL.md'), 'Synthetic owned fixture');
  watcher = watch(resource, { persistent: false });
  const observed = once(watcher, 'change', { signal: AbortSignal.timeout(5000) });
  await writeFile(join(resource, 'sample.md'), 'Synthetic attachment');
  await observed;
  let blocked = false;
  let failure = 'none';
  try {
    await rename(source, target);
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EBUSY' && error?.code !== 'EACCES') throw error;
    blocked = true;
    failure = error.code;
  }
  const closed = once(watcher, 'close');
  watcher.close();
  await closed;
  watcher = undefined;
  if (blocked) await rename(source, target);
  console.log(JSON.stringify({ probe: 'owned-descendant-watch-rename', platform: process.platform, watchObserved: true, blocked, failure, afterCloseRename: true }));
} finally {
  if (watcher) {
    const closed = once(watcher, 'close');
    watcher.close();
    await closed;
  }
  await rm(root, { recursive: true, force: true });
}
