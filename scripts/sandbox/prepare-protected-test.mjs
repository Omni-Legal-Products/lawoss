/** CI-only preparation for the actual confined-engine acceptance suite. */
import { execFileSync } from 'node:child_process';
import { appendFile, copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (!process.env.RUNNER_TEMP || !process.env.GITHUB_ENV) throw new Error('An owned CI runtime directory and environment file are required');
const runtime = resolve(root, 'apps/server/resources/agent-sandbox/runtime');
const bundle = await mkdtemp(join(process.env.RUNNER_TEMP, 'protected-engine-'));
for (const [source, target] of [['protected-opencode', 'opencode'], ['protected-engine.mjs', 'protected-engine.mjs']]) await copyFile(join(runtime, source), join(bundle, target));
execFileSync('bun', ['build', join(root, 'apps/server/src/lawoss/protected-ai/document-plugin.ts'), '--outfile', join(bundle, 'plugin.mjs'), '--target', 'node', '--format', 'esm'], {stdio: 'inherit'});
await writeFile(join(bundle, 'config.json'), JSON.stringify({model: {id: 'synthetic', context: 100000, output: 4000, variants: {high: {}}}}));
const environment = {LAWOSS_PROTECTED_VM_TEST: '1', LAWOSS_PROTECTED_VM_TEST_RUNTIME: runtime, LAWOSS_PROTECTED_VM_TEST_BUNDLE: bundle};
for (const value of Object.values(environment)) if (/[\r\n]/.test(value)) throw new Error('Invalid CI path');
await appendFile(process.env.GITHUB_ENV, Object.entries(environment).map(([key, value]) => `${key}=${value}\n`).join(''));
