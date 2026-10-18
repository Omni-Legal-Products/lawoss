// Manifest-only admission; importing this core-only module performs no I/O.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { lstat, open, realpath } from 'node:fs/promises';
const TOOLS = new URL('./tools/package.json', import.meta.url);
const CODES = new Set(['TOOLS_LINK_ABSENT', 'TOOLS_MANIFEST_ABSENT', 'TOOLS_INVALID', 'TOOLS_ADMISSION_FAILED']);
const refuse = code => { throw Object.assign(new Error(code), { code }); };

// The optional URL admits owned filesystem fixtures; the CLI always uses TOOLS.
export async function preflightTools(toolsPackageUrl = TOOLS) {
  try {
    const entry = path.join(path.dirname(fileURLToPath(toolsPackageUrl)), 'node_modules/@npmcli/arborist');
    try { await lstat(entry); }
    catch (error) { refuse(error.code === 'ENOENT' ? 'TOOLS_LINK_ABSENT' : 'TOOLS_ADMISSION_FAILED'); }
    const manifest = path.join(entry, 'package.json');
    let handle;
    try { handle = await open(manifest, 'r'); }
    catch (error) { refuse(error.code === 'ENOENT' ? 'TOOLS_MANIFEST_ABSENT' : 'TOOLS_ADMISSION_FAILED'); }
    let value;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) refuse('TOOLS_ADMISSION_FAILED');
      if (stat.size > 65536) refuse('TOOLS_INVALID');
      const bytes = Buffer.alloc(65537); let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) break; length += bytesRead;
      }
      if (length > 65536) refuse('TOOLS_INVALID');
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    } finally { await handle.close(); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.name !== '@npmcli/arborist' || value.version !== '9.4.0') refuse('TOOLS_INVALID');
    const require = createRequire(toolsPackageUrl);
    const resolved = require.resolve('@npmcli/arborist/package.json');
    if (await realpath(resolved) !== await realpath(manifest)) refuse('TOOLS_ADMISSION_FAILED');
    return { name: '@npmcli/arborist', version: '9.4.0' };
  } catch (error) { refuse(CODES.has(error?.code) ? error.code : 'TOOLS_ADMISSION_FAILED'); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) refuse('TOOLS_ADMISSION_FAILED');
    await preflightTools(); console.log(JSON.stringify({ status: 'accepted', name: '@npmcli/arborist', version: '9.4.0' }));
  } catch (error) { console.error(JSON.stringify({ status: 'failed', code: CODES.has(error?.code) ? error.code : 'TOOLS_ADMISSION_FAILED' })); process.exitCode = 1; }
}
