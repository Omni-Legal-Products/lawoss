import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReleaseEvidence, validateReleaseEvidence, evidenceFilename, createPromotionReceipt, REQUIRED_NATIVE_SCENARIOS } from './release-evidence.mjs';
const build = { schemaVersion: 1, product: 'lawoss-desktop', version: '1.2.3-alpha.1', gitSha: 'a'.repeat(40), buildEpoch: '1792195200', platform: 'darwin', arch: 'arm64', channel: 'alpha', workflowRunUrl: 'https://example.invalid/build/1' };
const hash = x => createHash('sha256').update(x).digest('hex');
const asset = { name: `lawoss-mac-arm64-${build.version}.dmg`, size: 5, sha256: hash('final') };
export function completeEvidence() { return createReleaseEvidence({ build, releaseTag: 'alpha-fixture', assets: [asset], receipts: [{ state: 'built', at: '2026-10-17T00:00:00Z', actor: 'fixture', evidenceUrl: 'https://example.invalid/build' }, { state: 'signed', at: '2026-10-17T00:01:00Z', actor: 'fixture', evidenceUrl: 'https://example.invalid/sign', assetSha256: asset.sha256 }, { state: 'tested', at: '2026-10-17T00:02:00Z', actor: 'fixture', evidenceUrl: 'https://example.invalid/test', assetSha256: asset.sha256 }], signing: { status: 'verified', evidenceUrl: 'https://example.invalid/sign' }, acceptance: REQUIRED_NATIVE_SCENARIOS.flatMap(scenario => ['fresh', 'migrated'].map(profile => ({ scenario, profile, assetSha256: asset.sha256, status: 'pass', evidenceUrl: 'https://example.invalid/test' }))) }); }
test('reject_pre_sign_hash and reject_changed_bytes_same_filename', () => { const e = completeEvidence(); assert.throws(() => validateReleaseEvidence(e, [{ ...asset, sha256: hash('unsigned') }], { requireTested: true }), /asset|bytes/i); assert.throws(() => validateReleaseEvidence(e, [{ ...asset, size: 6 }], { requireTested: true })); });
test('reject_acceptance_for_other_platform_or_sha', () => { const e = completeEvidence(); e.acceptance[0].assetSha256 = hash('other platform'); assert.throws(() => validateReleaseEvidence(e, [asset], { requireTested: true }), /acceptance/i); });
test('not_run_is_not_pass and source_unit_pass_is_not_packaged_pass', () => { for (const status of ['not-run', 'blocked', 'fail']) {
    const e = completeEvidence();
    e.acceptance[0].status = status;
    assert.throws(() => validateReleaseEvidence(e, [asset], { requireTested: true }), /acceptance/i);
} const e = completeEvidence(); e.acceptance = e.acceptance.filter(x => x.profile === 'fresh'); assert.throws(() => validateReleaseEvidence(e, [asset], { requireTested: true }), /migrated/i); });
test('reject_missing_installer and evidence_excludes_itself', () => { const e = completeEvidence(); assert.throws(() => createReleaseEvidence({ ...e, assets: [] })); assert.throws(() => createReleaseEvidence({ ...e, assets: [...e.assets, { name: evidenceFilename(build), size: 1, sha256: hash('self') }] })); });
test('same_tag_two_targets_have_distinct_evidence', () => { assert.equal(evidenceFilename(build), 'release-evidence-darwin-arm64.json'); assert.notEqual(evidenceFilename(build), evidenceFilename({ ...build, arch: 'x64' })); });
test('shared_manifest_waits_for_all_referenced_targets', () => { const e = completeEvidence(); const manifest = { name: 'latest-mac.yml', sha256: hash('manifest'), references: [asset.name, 'lawoss-mac-x64-1.2.3-alpha.1.dmg'] }; assert.throws(() => createPromotionReceipt({ manifest, evidences: [{ evidence: e, sha256: hash('evidence') }] }), /missing|target/i); const receipt = createPromotionReceipt({ manifest: { ...manifest, references: [asset.name] }, evidences: [{ evidence: e, sha256: hash('evidence') }] }); assert.equal(receipt.manifest.sha256, manifest.sha256); });
test('verified signing requires per-installer signed receipt and URL', () => { const e = completeEvidence(); e.receipts = e.receipts.filter(x => x.state !== 'signed'); assert.throws(() => validateReleaseEvidence(e, [asset], { requireTested: true }), /sign/i); });
test('native acceptance import binds profile, build and final installer; blocked cannot become tested', async () => {
    const { importNativeAcceptance } = await import('./release-evidence.mjs');
    const e = completeEvidence();
    e.acceptance = [];
    e.receipts = e.receipts.filter(x => !['tested', 'signed'].includes(x.state));
    e.signing = { status: 'unverified', evidenceUrl: null };
    const receipt = { schemaVersion: 1, status: 'pass', build, profile: 'fresh', profileOwner: 'fixture-owner', assetSha256: asset.sha256, at: '2026-10-17T01:00:00Z', operator: 'fixture operator', evidenceUrl: 'https://example.invalid/native', acceptance: REQUIRED_NATIVE_SCENARIOS.map(scenario => ({ scenario, profile: 'fresh', assetSha256: asset.sha256, status: 'pass', evidenceUrl: 'https://example.invalid/native' })), native: { profileKind: 'fresh', build, assetSha256: asset.sha256, legalworkDevMode: false, signature: { status: 'verified', method: 'codesign-spctl-and-installer-tree' } } };
    assert.throws(() => importNativeAcceptance(e, { ...receipt, status: 'blocked' }), /pass/i);
    assert.throws(() => importNativeAcceptance(e, { ...receipt, build: { ...build, gitSha: 'b'.repeat(40) } }), /identity|build/i);
    const fresh = importNativeAcceptance(e, receipt);
    assert.ok(!fresh.receipts.some(x => x.state === 'tested'));
    const migrated = importNativeAcceptance(fresh, { ...receipt, profile: 'migrated', profileOwner: 'migrated-owner', acceptance: receipt.acceptance.map(x => ({ ...x, profile: 'migrated' })), native: { ...receipt.native, profileKind: 'migrated' } });
    assert.doesNotThrow(() => validateReleaseEvidence(migrated, [asset], { requireTested: true }));
});
test('published receipt requires public exact-tag readback, never a draft or changed asset', async () => { const { recordPublishedEvidence } = await import('./release-evidence.mjs'); const e = completeEvidence(), receipt = { release: { tagName: e.releaseTag, isDraft: false }, observedAssets: [asset], actor: 'fixture', at: '2026-10-17T02:00:00Z', evidenceUrl: 'https://example.invalid/published' }; assert.throws(() => recordPublishedEvidence(e, { ...receipt, release: { ...receipt.release, isDraft: true } }), /draft|public/i); assert.throws(() => recordPublishedEvidence(e, { ...receipt, observedAssets: [{ ...asset, sha256: sha256ForTest('changed') }] })); assert.equal(recordPublishedEvidence(e, receipt).receipts.at(-1).state, 'published'); });
function sha256ForTest(text) { return createHash('sha256').update(text).digest('hex'); }
