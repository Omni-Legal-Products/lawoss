import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
if (manifest.id !== 'lawoss-okf' || manifest.version !== '0.1.0' || !manifest.isDesktopOnly) throw new Error('Unexpected pilot manifest');
const files = ['main.js', 'manifest.json', 'styles.css', 'LICENSE'];
const contents = {};
const hashes = {};
for (const file of files) { const data = new Uint8Array(await readFile('dist/' + file)); contents[`lawoss-okf/${file}`] = [data, { mtime: new Date(2026, 0, 1, 0, 0, 0) }]; hashes[file] = createHash('sha256').update(data).digest('hex'); }
contents['lawoss-okf/README.txt'] = [strToU8('LAWOSS OKF desktop pilot. Copy lawoss-okf/ into the vault configuration folder plugins/. Review README.md in the source repository before enabling. No automatic installation or synchronization.\n'), { mtime: new Date(2026, 0, 1, 0, 0, 0) }];
await mkdir('artifacts', { recursive: true });
const filename = `lawoss-okf-${manifest.version}.zip`;
const bytes = zipSync(contents, { level: 9 });
await writeFile('artifacts/' + filename, bytes);
await writeFile('artifacts/SHA256SUMS', `${createHash('sha256').update(bytes).digest('hex')}  ${filename}\n`);
await writeFile('artifacts/content-hashes.json', JSON.stringify(hashes, null, 2) + '\n');
console.log(`Prepared ${filename}, ${bytes.length} bytes; not installed or published.`);
