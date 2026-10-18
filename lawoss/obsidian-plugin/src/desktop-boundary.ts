/** Desktop-only host validation. File contents are still read through Vault API. */
import { lstat, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { validRoot } from '../../okf-reader/src/index.ts';
export function physicalBoundary(root: string): (path: string) => Promise<void> {
  return async path => {
    if (!validRoot(path)) throw new Error('Invalid vault-relative path');
    const base = await realpath(root);
    let target = base;
    for (const part of path.split('/').filter(Boolean)) {
      target = resolve(target, part);
      if ((await lstat(target)).isSymbolicLink()) throw new Error('Unsupported symlink in vault path');
    }
    const actual = await realpath(target);
    const rel = relative(base, actual);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('Path outside vault');
  };
}
