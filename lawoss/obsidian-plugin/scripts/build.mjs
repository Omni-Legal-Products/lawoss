import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
const result = await build({ entryPoints: ['src/main.ts'], outfile: 'dist/main.js', bundle: true, platform: 'browser', target: 'es2022', format: 'cjs', external: ['obsidian', 'node:fs/promises', 'node:path'], metafile: true, sourcemap: false, minify: false, legalComments: 'eof' });
// Audited Node imports are limited to a read-only desktop path guard. The shared core must remain portable.
for (const input of Object.keys(result.metafile.inputs)) {
  if (/okf-pamat\/src\/(index|write|store|config|cli|workspace-memory.*)\.ts$/.test(input)) throw new Error('Write/server dependency in plugin: ' + input);
}
const external = Object.values(result.metafile.outputs).flatMap(o => o.imports.filter(i => i.external).map(i => i.path));
if (external.some(path => !['obsidian', 'node:fs/promises', 'node:path'].includes(path))) throw new Error('Unexpected external module');
for (const file of ['manifest.json', 'styles.css', 'versions.json']) await copyFile(file, 'dist/' + file);
await copyFile('../../LICENSE', 'dist/LICENSE');
await writeFile('dist/build-inputs.json', JSON.stringify(Object.keys(result.metafile.inputs).sort(), null, 2) + '\n');
// A separate browser build proves core portability, not native Obsidian acceptance.
await build({ entryPoints: ['../okf-reader/src/index.ts'], outfile: 'dist/reader-browser.js', bundle: true, platform: 'browser', target: 'es2022', format: 'esm' });
