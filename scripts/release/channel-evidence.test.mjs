import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChannelPromotion } from './channel-evidence.mjs';
import { createReleaseEvidence, REQUIRED_NATIVE_SCENARIOS, sha256 } from './release-evidence.mjs';
function fixture() { const digest = sha256('final'), evidenceUrl = 'https://example.invalid/native', asset = { name: 'lawoss-win-arm64-1.2.3-alpha.2.exe', size: 5, sha256: digest }; return { evidence: createReleaseEvidence({ build: { schemaVersion: 1, product: 'lawoss-desktop', version: '1.2.3-alpha.2', gitSha: 'a'.repeat(40), buildEpoch: '123', platform: 'win32', arch: 'arm64', channel: 'alpha', workflowRunUrl: evidenceUrl }, releaseTag: 'alpha-run', assets: [asset], receipts: ['built', 'signed', 'tested', 'published'].map(state => ({ state, at: '2026-10-17T00:00:00Z', actor: 'fixture', evidenceUrl, assetSha256: digest })), signing: { status: 'verified', evidenceUrl }, acceptance: REQUIRED_NATIVE_SCENARIOS.flatMap(scenario => ['fresh', 'migrated'].map(profile => ({ scenario, profile, status: 'pass', assetSha256: digest, evidenceUrl }))) }), release: { tagName: 'alpha-run', isDraft: false }, observedAssets: [asset], pointerTag: 'alpha-windows-latest', manifestName: 'latest-arm64.yml', currentVersion: '1.2.3-alpha.1' }; }
test('draft_never_moves_pointer', () => { const f = fixture(); f.release.isDraft = true; assert.throws(() => validateChannelPromotion(f), /draft/i); });
test('unsigned_windows_never_public and internal_unsigned_stays_draft', () => { for (const status of ['unsigned-internal', 'unverified']) {
    const f = fixture();
    f.evidence.signing.status = status;
    assert.throws(() => validateChannelPromotion(f), /sign/i);
} });
test('arch_pointer_isolated', () => { const f = fixture(); f.manifestName = 'latest.yml'; assert.throws(() => validateChannelPromotion(f), /architecture|target/i); f.manifestName = 'latest-arm64.yml'; assert.doesNotThrow(() => validateChannelPromotion(f)); });
test('failed_publish_preserves_pointer and changed_uploaded_bytes_refuses_promotion', () => { const f = fixture(); f.evidence.receipts = f.evidence.receipts.filter(x => x.state !== 'published'); assert.throws(() => validateChannelPromotion(f), /published/i); const changed = fixture(); changed.observedAssets[0] = { ...changed.observedAssets[0], sha256: sha256('changed') }; assert.throws(() => validateChannelPromotion(changed), /bytes/i); });
test('older_semver_does_not_bypass_downgrade_guard', () => { const f = fixture(); f.currentVersion = '1.2.4-alpha.1'; assert.throws(() => validateChannelPromotion(f), /newer|downgrade/i); f.currentVersion = '1.2.3-alpha.2'; assert.throws(() => validateChannelPromotion(f), /newer|downgrade/i); });
