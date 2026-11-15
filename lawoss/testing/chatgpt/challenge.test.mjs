import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { decryptChallenge, encryptChallenge, recipientKey } from './challenge.mjs';
import { control, preflight } from './control.mjs';

const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
const passphrase = 'synthetic-local-test-passphrase';
const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase });
const challenge = { url: 'https://auth.openai.com/codex/device', code: 'ABCD-EFGH', expiresAt: Date.now() + 60_000,
  model: 'gpt-6-luna', platform: 'macos-15', run: '123-1', sha: 'a'.repeat(40) };
const env = { CHATGPT_PROBE_CONSENT: 'true', CHATGPT_PROBE_MODEL: challenge.model, CHATGPT_PROBE_PLATFORM: challenge.platform,
  CHATGPT_PROBE_PUBLIC_KEY: publicKey, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: challenge.sha };

test('only the operator private key can recover the allowlisted challenge; no plaintext code is published', () => {
  const envelope = encryptChallenge(challenge, publicKey);
  assert.equal(JSON.stringify(envelope).includes(challenge.code), false);
  assert.deepEqual(decryptChallenge(envelope, privateKey, passphrase), challenge);
  assert.throws(() => decryptChallenge(envelope, privateKey, 'wrong passphrase'));
  const other = generateKeyPairSync('rsa', { modulusLength: 3072 });
  assert.throws(() => decryptChallenge(envelope, other.privateKey.export({ type: 'pkcs8', format: 'pem' })));
  assert.throws(() => decryptChallenge({ ...envelope, tag: Buffer.alloc(16).toString('base64') }, privateKey, passphrase));
  assert.throws(() => decryptChallenge({ ...envelope, tag: Buffer.alloc(4).toString('base64') }, privateKey, passphrase));
});

test('refuses weak keys, private keys, arbitrary fields, URLs and unsafe instructions', () => {
  const weak = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => recipientKey(weak.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')));
  assert.throws(() => recipientKey(privateKey));
  assert.throws(() => encryptChallenge({ ...challenge, access_token: 'must-not-be-exported' }, publicKey));
  assert.throws(() => encryptChallenge({ ...challenge, url: 'https://example.invalid' }, publicKey));
  assert.throws(() => encryptChallenge({ ...challenge, code: 'ABCD\n::add-mask::unsafe' }, publicKey));
});

test('preflight requires explicit consent, exact run identity, known model and a valid recipient', () => {
  assert.doesNotThrow(() => preflight(env));
  for (const key of Object.keys(env)) assert.throws(() => preflight({ ...env, [key]: '' }));
  assert.throws(() => preflight({ ...env, CHATGPT_PROBE_MODEL: 'unknown-model' }));
  assert.throws(() => preflight({ ...env, CHATGPT_PROBE_CONSENT: 'false' }));
});

test('controller refuses missing explicit engine before creating an owned profile', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatgpt-controller-'));
  try {
    await assert.rejects(control('launch', path.join(root, 'probe'), env), /verified native engine/);
    await assert.rejects(readFile(path.join(root, 'probe', 'owner.json')), /ENOENT/);
    await writeFile(path.join(root, 'owner.json'), JSON.stringify({ kind: 'foreign', nonce: 'a'.repeat(36) }));
    await assert.rejects(control('stop', root), /Not an owned/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local CLI stores an encrypted private key and refuses to print the code inside Actions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chatgpt-operator-'));
  const cli = fileURLToPath(new URL('./challenge.mjs', import.meta.url));
  const localEnv = { ...process.env, CHATGPT_KEY_PASSPHRASE: passphrase, GITHUB_ACTIONS: 'false' };
  try {
    const created = spawnSync(process.execPath, [cli, 'keygen', path.join(root, 'keys')], { env: localEnv, encoding: 'utf8' });
    assert.equal(created.status, 0);
    const key = await readFile(path.join(root, 'keys', 'private.pem'), 'utf8');
    assert.match(key, /BEGIN ENCRYPTED PRIVATE KEY/);
    const filename = path.join(root, 'challenge.json');
    await writeFile(filename, JSON.stringify(encryptChallenge(challenge, created.stdout.trim())));
    const args = [cli, 'decrypt', filename, path.join(root, 'keys', 'private.pem')];
    const decoded = spawnSync(process.execPath, args, { env: localEnv, encoding: 'utf8' });
    assert.equal(decoded.status, 0);
    assert.deepEqual(JSON.parse(decoded.stdout), challenge);
    const refused = spawnSync(process.execPath, args, { env: { ...localEnv, GITHUB_ACTIONS: 'true' }, encoding: 'utf8' });
    assert.equal(refused.status, 1);
    assert.equal(refused.stdout, '');
    assert.equal(refused.stderr.includes(challenge.code), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('workflow is opt-in on dev, has all native platforms and publishes only the encrypted challenge and finite report', async () => {
  const require = createRequire(new URL('../../../apps/server/package.json', import.meta.url));
  const { parse } = require('yaml');
  const source = await readFile(new URL('../../../.github/workflows/chatgpt-subscription-smoke.yml', import.meta.url), 'utf8');
  const workflow = parse(source);
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.match(workflow.jobs.preflight.if, /github.ref == 'refs\/heads\/dev'.*inputs.authorize/);
  assert.match(workflow.jobs.refused.if, /github.ref != 'refs\/heads\/dev'.*!inputs.authorize/);
  assert.equal(workflow.jobs.refused.steps[0].run, 'exit 1');
  assert.deepEqual(workflow.jobs.subscription.strategy.matrix.os, ['macos-15', 'windows-2022', 'windows-11-arm']);
  assert.equal(workflow.jobs.subscription.strategy['max-parallel'], 1);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(source.includes('secrets.'), false);
  assert.equal(source.includes('pull_request_target'), false);
  const launch = workflow.jobs.subscription.steps.find(step => step.name === 'Start isolated native OAuth worker');
  assert.equal(launch.env.LEGALWORK_OPENCODE_BIN, '${{ env.LEGALWORK_TEST_OPENCODE_BIN }}');
  const installer = await readFile(new URL('../../../packages/opencode-release/install.mjs', import.meta.url), 'utf8');
  assert.match(installer, /LEGALWORK_TEST_OPENCODE_BIN=\$\{installed.path\}/);
  const uploads = workflow.jobs.subscription.steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.deepEqual(uploads.map(step => step.with.path), [
    '${{ runner.temp }}/chatgpt-subscription/public/challenge.json', '${{ runner.temp }}/chatgpt-subscription/public/report.json',
  ]);
  assert.equal(workflow.jobs.subscription.steps.find(step => step.name === 'Stop the owned worker and erase credentials').if, 'always()');
});
