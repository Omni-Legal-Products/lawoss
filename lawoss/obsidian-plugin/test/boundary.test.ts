import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { physicalBoundary } from '../src/desktop-boundary.ts';

test('desktop host refuses symlinks and paths outside the actual vault', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'okf-boundary-'));
  try {
    const vault = join(dir, 'vault'); const outside = join(dir, 'outside');
    await mkdir(vault); await mkdir(outside); await writeFile(join(vault, 'ok.md'), 'ok'); await writeFile(join(outside, 'secret.md'), 'private synthetic');
    await symlink(outside, join(vault, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    const check = physicalBoundary(vault);
    await check('ok.md');
    await expect(check('../outside/secret.md')).rejects.toThrow();
    await expect(check('alias/secret.md')).rejects.toThrow('symlink');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
