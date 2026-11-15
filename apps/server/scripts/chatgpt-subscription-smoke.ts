// Explicit manual Actions probe only; not imported by normal unit tests or application startup.
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OpenCode } from '@opencode/client';
import { createManagedOpencodeServer, type ManagedOpencodeServer } from '../src/managed-opencode.js';
import { authenticateSubscription, SubscriptionProbeError, verifySubscription } from '../src/lawoss/test-support/chatgpt-subscription-probe.js';
import { encryptChallenge } from '../../../lawoss/testing/chatgpt/challenge.mjs';
import { preflight } from '../../../lawoss/testing/chatgpt/control.mjs';

async function run() {
  preflight(process.env);
  const root = await realpath(process.argv[2]);
  const owner = JSON.parse(await readFile(join(root, 'owner.json'), 'utf8'));
  if (owner.kind !== 'lawoss-chatgpt-probe') throw new Error('Owned root required');
  const profile = join(root, 'private');
  await mkdir(profile, { mode: 0o700 });
  for (const name of ['home', 'config', 'data', 'cache', 'state', 'tmp', 'project']) await mkdir(join(profile, name), { mode: 0o700 });
  const directory = join(profile, 'project');
  const model = process.env.CHATGPT_PROBE_MODEL!;
  const publicKey = process.env.CHATGPT_PROBE_PUBLIC_KEY!;
  const identity = { model, platform: process.env.CHATGPT_PROBE_PLATFORM!, run: `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`, sha: process.env.GITHUB_SHA! };
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 12 * 60_000);
  const stop = setInterval(() => {
    void Bun.file(join(root, 'stop')).exists().then(exists => { if (exists) controller.abort(); });
  }, 500);
  const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT'].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  const options = {
    bin: process.env.LEGALWORK_OPENCODE_BIN, cwd: directory, inheritEnvironment: false, parentLease: true, signal: controller.signal, timeoutMs: 90_000,
    env: { ...env, HOME: join(profile, 'home'), USERPROFILE: join(profile, 'home'),
      XDG_CONFIG_HOME: join(profile, 'config'), XDG_DATA_HOME: join(profile, 'data'), XDG_CACHE_HOME: join(profile, 'cache'), XDG_STATE_HOME: join(profile, 'state'),
      TEMP: join(profile, 'tmp'), TMP: join(profile, 'tmp'), TMPDIR: join(profile, 'tmp'),
      OPENCODE_CONFIG_DIR: join(profile, 'config'), OPENCODE_DB: join(profile, 'engine.db'), OPENCODE_DISABLE_CLAUDE_CODE: '1',
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ update: 'disable', warming: false, default_agent: 'subscription-probe',
        providers: { openai: { settings: { transport: 'http' } } },
        policies: [{ action: 'provider.use', resource: '*', effect: 'deny' }, { action: 'provider.use', resource: 'openai', effect: 'allow' }],
        agents: { 'subscription-probe': { mode: 'primary', steps: 1, system: 'Synthetic subscription smoke. Reply only with the requested marker. Do not call tools.', permissions: [{ action: '*', resource: '*', effect: 'deny' }] },
          title: { disabled: true }, summary: { disabled: true } },
      }),
    },
  };
  let engine: ManagedOpencodeServer | undefined;
  let stage = 'engine_start', code = 'native_error', status = 'fail', rounds = 0, cleanup = false;
  const client = () => {
    if (!engine) throw new Error('Engine unavailable');
    return OpenCode.make({ baseUrl: engine.url, headers: { Authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString('base64')}` } });
  };
  try {
    engine = await createManagedOpencodeServer(options);
    stage = 'oauth';
    await authenticateSubscription({ client: client(), directory, signal: controller.signal, publish: async challenge => {
      const envelope = encryptChallenge({ ...identity, ...challenge }, publicKey);
      await writeFile(join(root, 'public', 'challenge.json'), JSON.stringify(envelope), { flag: 'wx', mode: 0o600 });
    } });
    stage = 'inference';
    await verifySubscription({ client: client(), directory, model, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]) });
    rounds++;
    stage = 'restart';
    await engine.close(); engine = undefined;
    engine = await createManagedOpencodeServer(options);
    await verifySubscription({ client: client(), directory, model, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]) });
    rounds++;
    status = 'pass'; code = 'ok'; stage = 'complete';
  } catch (error) {
    if (error instanceof SubscriptionProbeError) {
      code = error.code;
      if (['device_unavailable', 'auth_timeout', 'model_unavailable'].includes(code)) status = 'blocked';
    } else if (controller.signal.aborted) { code = 'cancelled_or_deadline'; status = 'blocked'; }
  } finally {
    clearTimeout(deadline); clearInterval(stop);
    try {
      await engine?.close();
      await rm(profile, { recursive: true, force: true });
      cleanup = true;
    } catch { status = 'fail'; code = 'cleanup_failed'; stage = 'cleanup'; }
    const report = { version: 1, scope: 'native-subscription-smoke', ...identity, status, stage, code, rounds, cleanup,
      apiKeyFallback: false, fullApplicationAcceptance: 'not-run', migrationAcceptance: 'not-run' };
    await writeFile(join(root, 'public', 'report.tmp'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    const { rename } = await import('node:fs/promises');
    await rename(join(root, 'public', 'report.tmp'), join(root, 'public', 'report.json'));
    if (cleanup) await writeFile(join(root, 'closed'), '', { flag: 'wx', mode: 0o600 });
  }
}

run().catch(() => { process.exitCode = 1; }); // Never serialize native exceptions or OAuth responses.
