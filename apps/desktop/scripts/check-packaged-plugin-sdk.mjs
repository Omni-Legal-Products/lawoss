// Same build-only admission used by afterPack. --prepackaged skips that hook,
// so final-distribution callers invoke this immediately before electron-builder.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { targetFromTriple } from '../../../scripts/release/build-info.mjs';
import { desktopProductSdkTarget, verifyDesktopProductSdkPackaging } from '../../../lawoss/build/plugin-payload/desktop-packaging.mjs';

export function parsePackagedPluginSdkArguments(args) {
  const input = new Map(), names = ['--asar', '--target', '--mode'];
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!names.includes(key) || input.has(key) || typeof value !== 'string' || !value || value.length > 4096) throw new Error('Invalid SDK gate arguments');
    input.set(key, value);
  }
  const triple = input.get('--target'), mode = input.get('--mode');
  const triples = ['aarch64-apple-darwin', 'x86_64-apple-darwin', 'aarch64-pc-windows-msvc', 'x86_64-pc-windows-msvc', 'aarch64-unknown-linux-gnu', 'x86_64-unknown-linux-gnu'];
  if (input.size !== 3 || !triples.includes(triple) || !['sdk', 'without-sdk', 'development'].includes(mode) || path.basename(input.get('--asar')) !== 'app.asar') throw new Error('Invalid SDK gate arguments');
  const target = targetFromTriple(triple);
  return Object.freeze({ resourcesRoot: path.dirname(path.resolve(input.get('--asar'))), target: desktopProductSdkTarget(target.platform, target.arch), expectedMode: mode });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyDesktopProductSdkPackaging(parsePackagedPluginSdkArguments(process.argv.slice(2)));
    process.stdout.write(JSON.stringify({ status: result.status, mode: result.mode, target: result.target,
      ...(result.manifestSha256 ? { manifestSha256: result.manifestSha256, capsuleSha256: result.capsuleSha256 } : {}) }) + '\n');
  } catch (error) {
    let code = 'DESKTOP_SDK_PACKAGING_FAILED';
    try { const value = error?.code; if (typeof value === 'string' && /^[A-Z_]{1,48}$/.test(value)) code = value; } catch {}
    process.stderr.write(JSON.stringify({ status: 'failed', code }) + '\n'); process.exitCode = 1;
  }
}
