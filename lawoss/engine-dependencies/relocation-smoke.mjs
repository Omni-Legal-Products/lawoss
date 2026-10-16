import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectTree, closedChild, isolatedEnvironment } from './package-runtime.mjs';

// Only the marked artifact is moved; checkout, toolstore and source install stay put.
export async function relocationSmoke({ staged, parent, node }) {
  await inspectTree(staged);
  const marker = await fs.readFile(path.join(staged, '.lawoss-runtime-build'), 'utf8');
  if (marker !== 'lawoss-engine-dependencies-v1\n') throw Error('UNOWNED_STAGE');
  const root = await fs.mkdtemp(path.join(parent, 'relocated # % '));
  const relocated = path.join(root, 'engine-dependencies');
  const hidden = `${staged}.hidden`;
  if (await fs.lstat(hidden).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; })) throw Error('HIDDEN_EXISTS');
  let moved = false;
  try {
    await fs.cp(staged, relocated, { recursive: true, dereference: false });
    await fs.rename(staged, hidden); moved = true;
    const home = path.join(root, 'home');
    await fs.mkdir(home);
    for (const name of ['user.npmrc', 'global.npmrc']) await fs.writeFile(path.join(home, name), '');
    const program = `
      import fs from 'node:fs';
      import path from 'node:path';
      import { createRequire } from 'node:module';
      import { pathToFileURL } from 'node:url';
      if (process.version !== 'v22.23.2') throw Error('NODE_VERSION');
      const root = process.cwd();
      const require = createRequire(pathToFileURL(path.join(root, 'runtime-tools/package.json')));
      const {localRuntimePackage} = await import(pathToFileURL(path.join(root, 'runtime-tools.mjs')));
      const Config = localRuntimePackage('@npmcli/config', '10.8.1', ['@npmcli/config/lib/definitions'])('@npmcli/config');
      const defs = require('@npmcli/config/lib/definitions');
      const config = new Config({npmPath: path.join(root, 'runtime-tools'), cwd: root, env: process.env, argv: [process.execPath, process.execPath], execPath: process.execPath, ...defs});
      await config.load();
      const Arborist = localRuntimePackage('@npmcli/arborist', '9.4.0')('@npmcli/arborist');
      await new Arborist({path: path.join(root, 'runtime-tools'), offline: true}).loadActual();
      for (const name of ['config-roles', 'npm-config', 'dependency-lease', 'prepare-target']) await import(pathToFileURL(path.join(root, name + '.mjs')));
      for (const file of Object.keys(require.cache)) {
        const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file));
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('ESCAPED_CLOSURE');
      }
      console.log(JSON.stringify({schema:1,status:'relocated',node:'22.23.2',config:'10.8.1',arborist:'9.4.0',modules:Object.keys(require.cache).length}));
    `;
    const result = await closedChild(node, ['--input-type=module', '--eval', program], { cwd: relocated, env: isolatedEnvironment(home) });
    return JSON.parse(result);
  } finally {
    if (moved) await fs.rename(hidden, staged);
    await fs.rm(root, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await relocationSmoke({ staged: process.argv[2], parent: process.argv[3], node: process.execPath }))); }
  catch { console.error('RELOCATION_FAILED'); process.exitCode = 1; }
}
