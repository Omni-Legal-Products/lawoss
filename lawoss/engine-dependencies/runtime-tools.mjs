import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const tools = fileURLToPath(new URL('./runtime-tools/', import.meta.url));
const require = createRequire(new URL('./runtime-tools/package.json', import.meta.url));

// Identity-only preflight. Package implementation is evaluated only by load().
export function localRuntimePackage(name, version, extra = []) {
  try {
    const local = realpathSync(path.join(tools, 'node_modules', name));
    const manifest = require.resolve(`${name}/package.json`);
    if (realpathSync(path.dirname(manifest)) !== local) throw Error();
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    if (pkg.name !== name || pkg.version !== version) throw Error();
    const allowed = new Set([name, ...extra]);
    for (const specifier of allowed) {
      const relative = path.relative(local, realpathSync(require.resolve(specifier)));
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error();
    }
    return specifier => {
      try {
        if (!allowed.has(specifier)) throw Error();
        return require(specifier);
      } catch { throw Object.assign(new Error('TOOLING_UNAVAILABLE'), { code: 'TOOLING_UNAVAILABLE' }); }
    };
  } catch { throw Object.assign(new Error('TOOLING_UNAVAILABLE'), { code: 'TOOLING_UNAVAILABLE' }); }
}
