import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPackagedBuildInfo, getAppBuildInfo } from './build-info.mjs';
const embedded = { schemaVersion: 1, product: 'lawoss-desktop', version: '1.2.3-alpha.1', gitSha: 'a'.repeat(40), buildEpoch: '1792195200', platform: 'darwin', arch: 'x64', channel: 'alpha', workflowRunUrl: 'https://github.com/fixture/lawoss/actions/runs/1' };
async function fixture(t) { const root = await mkdtemp(join(tmpdir(), 'build-info-')); t.after(() => rm(root, { recursive: true, force: true })); return { resourcesPath: root, version: embedded.version, platform: 'darwin', arch: 'x64' }; }
test('packaged_ignores_conflicting_env', async (t) => { const opts = await fixture(t); await writeFile(join(opts.resourcesPath, 'build-info.json'), JSON.stringify(embedded)); const result = await getAppBuildInfo({ ...opts, isPackaged: true, env: { LEGALWORK_GIT_SHA: 'b'.repeat(40), LEGALWORK_DEV_MODE: '1' } }); assert.equal(result.gitSha, embedded.gitSha); assert.equal(result.provenance, 'embedded'); assert.equal(result.legalworkDevMode, false); });
test('reject_version_or_target_mismatch', async (t) => { const opts = await fixture(t); await writeFile(join(opts.resourcesPath, 'build-info.json'), JSON.stringify(embedded)); for (const patch of [{ version: '9.0.0' }, { platform: 'win32' }, { arch: 'arm64' }])
    assert.equal(await readPackagedBuildInfo({ ...opts, ...patch }), null); });
test('missing_or_malformed_info_is_unavailable', async (t) => { const opts = await fixture(t); for (const raw of [null, '{', JSON.stringify({ ...embedded, gitSha: 'short' }), JSON.stringify({ ...embedded, unexpected: true })]) {
    if (raw !== null)
        await writeFile(join(opts.resourcesPath, 'build-info.json'), raw);
    const r = await getAppBuildInfo({ ...opts, isPackaged: true, env: { LEGALWORK_GIT_SHA: 'b'.repeat(40) } });
    assert.equal(r.provenance, 'unavailable');
    assert.equal(r.gitSha, null);
    assert.equal(r.buildEpoch, null);
} });
test('dev_is_explicitly_development', async () => { const r = await getAppBuildInfo({ version: '0.0.0', platform: 'darwin', arch: 'arm64', isPackaged: false, env: { LEGALWORK_GIT_SHA: 'b'.repeat(40), LEGALWORK_BUILD_EPOCH: '123' } }); assert.equal(r.provenance, 'development'); assert.equal(r.gitSha, 'b'.repeat(40)); });
