import { spawn } from 'node:child_process';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { recipientKey } from './challenge.mjs';
import { CHATGPT_SUBSCRIPTION_MODELS } from '../../providers/chatgpt-subscription.mjs';

export function preflight(env) {
  if (env.CHATGPT_PROBE_CONSENT !== 'true') throw new Error('Explicit subscription test consent is required');
  if (!CHATGPT_SUBSCRIPTION_MODELS.has(env.CHATGPT_PROBE_MODEL)) throw new Error('Choose an explicit subscription model from the application allowlist');
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '') || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) throw new Error('Requires an exact Actions run identity');
  if (!['macos-15', 'windows-2022', 'windows-11-arm'].includes(env.CHATGPT_PROBE_PLATFORM)) throw new Error('Unsupported platform');
  recipientKey(env.CHATGPT_PROBE_PUBLIC_KEY);
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function exists(filename) {
  return stat(filename).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
}

export async function control(command, directory, env = process.env) {
  if (command === 'preflight') { preflight(env); return; }
  if (!directory) throw new Error('An owned run directory is required');
  const root = path.resolve(directory);
  if (command === 'launch') {
    preflight(env);
    if (!env.LEGALWORK_OPENCODE_BIN || !path.isAbsolute(env.LEGALWORK_OPENCODE_BIN)
      || !(await stat(env.LEGALWORK_OPENCODE_BIN)).isFile()) throw new Error('Set up the verified native engine before launch');
    await realpath(path.dirname(root));
    await mkdir(root, { mode: 0o700 });
    await mkdir(path.join(root, 'public'), { mode: 0o700 });
    await writeFile(path.join(root, 'owner.json'), JSON.stringify({ kind: 'lawoss-chatgpt-probe', nonce: randomUUID() }), { flag: 'wx', mode: 0o600 });
    // The worker and engine get no GitHub token, API key, proxies or ambient model configuration.
    const allowed = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'RUNNER_TRACKING_ID',
      'LEGALWORK_OPENCODE_BIN', 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT',
      'CHATGPT_PROBE_CONSENT', 'CHATGPT_PROBE_MODEL', 'CHATGPT_PROBE_PLATFORM', 'CHATGPT_PROBE_PUBLIC_KEY'];
    const workerEnv = Object.fromEntries(allowed.filter(key => env[key] !== undefined).map(key => [key, env[key]]));
    const worker = fileURLToPath(new URL('../../../apps/server/scripts/chatgpt-subscription-smoke.ts', import.meta.url));
    const child = spawn('bun', [worker, root], { env: workerEnv, detached: true, windowsHide: true, stdio: 'ignore' });
    let stopped = false, failed = false;
    child.once('error', () => { failed = true; }); child.once('exit', () => { stopped = true; }); child.unref();
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline) {
      if (await exists(path.join(root, 'public', 'challenge.json'))) {
        console.log('Encrypted device challenge is ready. Download the challenge artifact and decrypt it locally.');
        return;
      }
      if (failed || stopped || await exists(path.join(root, 'public', 'report.json'))) throw new Error('Subscription probe could not start; inspect its finite report');
      await pause(250);
    }
    await writeFile(path.join(root, 'stop'), '', { flag: 'a', mode: 0o600 });
    throw new Error('Subscription probe startup deadline exceeded');
  }
  const owner = JSON.parse(await readFile(path.join(root, 'owner.json'), 'utf8'));
  if (owner.kind !== 'lawoss-chatgpt-probe' || !/^[a-f0-9-]{36}$/.test(owner.nonce)) throw new Error('Not an owned subscription probe');
  if (command === 'stop') {
    await writeFile(path.join(root, 'stop'), '', { flag: 'a', mode: 0o600 });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (await exists(path.join(root, 'closed'))) return;
      await pause(250);
    }
    throw new Error('Owned probe did not confirm shutdown; runner disposal is still required');
  }
  if (command !== 'wait') throw new Error('Use preflight, launch, wait or stop');
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const filename = path.join(root, 'public', 'report.json');
    if (await exists(filename)) {
      const report = JSON.parse(await readFile(filename, 'utf8'));
      // Never print arbitrary file contents, native errors, prompts or credentials.
      if (report.version !== 1 || report.scope !== 'native-subscription-smoke' || !['pass', 'fail', 'blocked'].includes(report.status)) throw new Error('Invalid probe report');
      console.log(`Subscription smoke: ${report.status}. See the finite report artifact; this is not full application acceptance.`);
      if (report.status !== 'pass' || report.cleanup !== true) throw new Error('Subscription smoke did not pass');
      return;
    }
    await pause(1000);
  }
  await writeFile(path.join(root, 'stop'), '', { flag: 'a', mode: 0o600 });
  throw new Error('Subscription smoke deadline exceeded');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await control(process.argv[2], process.argv[3]); }
  catch { console.error('Subscription control failed. Inspect the finite report; raw errors are not printed.'); process.exitCode = 1; }
}
