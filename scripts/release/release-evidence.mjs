#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFile, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateBuildInfo } from '../../apps/desktop/electron/build-info.mjs';
import { isElectronReleaseAsset } from './checksums.mjs';
// Each of these is a native journey, never a source unit-test substitute.
export const REQUIRED_NATIVE_SCENARIOS = Object.freeze(['onboarding', 'native-picker', 'okf', 'restart', 'memory', 'client-isolation', 'practice-overview', 'deadline-cz', 'deadline-sk', 'cloud-policy-cz', 'cloud-policy-sk']);
const digestPattern = /^[a-f0-9]{64}$/;
const states = ['built', 'signed', 'tested', 'published', 'delivered'];
const statuses = ['pass', 'fail', 'blocked', 'not-run'];
const url = value => typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value);
export const evidenceFilename = build => `release-evidence-${build.platform}-${build.arch}.json`;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function installer(asset) { return /\.(dmg|exe|AppImage|zip)$|\.tar\.gz$/i.test(asset.name); }
function ownsAsset(build, name) {
    const manifest = build.platform === 'win32' ? (build.arch === 'arm64' ? 'latest-arm64.yml' : 'latest.yml') : build.platform === 'linux' ? (build.arch === 'arm64' ? 'latest-linux-arm64.yml' : 'latest-linux.yml') : `latest-mac-${build.arch}.yml`;
    if (name === manifest)
        return true;
    const platform = build.platform === 'darwin' ? 'mac' : build.platform === 'win32' ? 'win' : 'linux';
    const arch = build.platform === 'linux' && build.arch === 'x64' && name.endsWith('.AppImage') ? 'x86_64' : build.arch;
    return name.startsWith(`lawoss-${platform}-${arch}-${build.version}.`);
}
export function createReleaseEvidence(input) {
    const result = { schemaVersion: 1, ...input };
    validateReleaseEvidence(result, result.assets);
    return result;
}
export function validateReleaseEvidence(evidence, observedAssets, { requireTested = false } = {}) {
    if (!evidence || evidence.schemaVersion !== 1)
        throw new Error('Invalid release evidence schema');
    const { build, assets, receipts, signing, acceptance } = evidence;
    validateBuildInfo(build);
    if (typeof evidence.releaseTag !== 'string' || !evidence.releaseTag || !Array.isArray(assets) || !assets.length || !Array.isArray(receipts) || !Array.isArray(acceptance))
        throw new Error('Missing release assets or receipts');
    if (!signing || !['verified', 'unsigned-internal', 'unverified'].includes(signing.status) || (signing.evidenceUrl !== null && !url(signing.evidenceUrl)))
        throw new Error('Invalid signing evidence');
    const names = new Set();
    const hashes = new Set();
    for (const asset of assets) {
        if (!asset || typeof asset.name !== 'string' || basename(asset.name) !== asset.name || /[\\\r\n]/.test(asset.name) || names.has(asset.name) || (!isElectronReleaseAsset(asset.name) && !/^latest.*\.yml$/.test(asset.name)) || !ownsAsset(build, asset.name) || !Number.isSafeInteger(asset.size) || asset.size <= 0 || !digestPattern.test(asset.sha256))
            throw new Error('Invalid, duplicate, self-referential or foreign target asset');
        names.add(asset.name);
        hashes.add(asset.sha256);
    }
    const installers = assets.filter(installer);
    if (!installers.length)
        throw new Error('Missing installer');
    if (!Array.isArray(observedAssets) || observedAssets.length !== assets.length)
        throw new Error('Observed asset set differs');
    for (const asset of assets) {
        const observed = observedAssets.find(x => x.name === asset.name);
        if (!observed || observed.size !== asset.size || observed.sha256 !== asset.sha256)
            throw new Error(`Final asset bytes differ: ${asset.name}`);
    }
    for (const receipt of receipts) {
        if (!states.includes(receipt.state) || !Number.isFinite(Date.parse(receipt.at)) || typeof receipt.actor !== 'string' || !receipt.actor || !url(receipt.evidenceUrl) || (receipt.state !== 'built' && !hashes.has(receipt.assetSha256)))
            throw new Error('Invalid state receipt or asset digest');
    }
    for (const result of acceptance) {
        if (typeof result.scenario !== 'string' || !result.scenario || !['fresh', 'migrated'].includes(result.profile) || !hashes.has(result.assetSha256) || !statuses.includes(result.status) || (result.status === 'pass' ? !url(result.evidenceUrl) : result.evidenceUrl !== null && !url(result.evidenceUrl)))
            throw new Error('Invalid acceptance receipt or target digest');
    }
    if (requireTested) {
        if (signing.status !== 'verified' || !url(signing.evidenceUrl))
            throw new Error('Verified signing evidence required');
        for (const asset of installers) {
            for (const state of ['signed', 'tested'])
                if (!receipts.some(r => r.state === state && r.assetSha256 === asset.sha256))
                    throw new Error(`Missing ${state} receipt for ${asset.name}`);
            for (const profile of ['fresh', 'migrated'])
                for (const scenario of REQUIRED_NATIVE_SCENARIOS) {
                    const results = acceptance.filter(r => r.profile === profile && r.scenario === scenario && r.assetSha256 === asset.sha256);
                    if (results.length !== 1 || results[0].status !== 'pass')
                        throw new Error(`Missing passing acceptance: ${profile}/${scenario}/${asset.name}`);
                }
        }
    }
}
export async function observeAssets(paths) { return Promise.all(paths.map(async (path) => { const bytes = await readFile(path); return { name: basename(path), size: bytes.length, sha256: sha256(bytes) }; })); }
export async function evidenceAssetsFromDirectory(evidence, root) { return observeAssets(evidence.assets.map(asset => join(root, asset.name))); }
/** Only the single promotion owner calls this after validating all target evidence. */
export function createPromotionReceipt({ manifest, evidences }) {
    if (!manifest || !digestPattern.test(manifest.sha256) || !Array.isArray(manifest.references) || !manifest.references.length)
        throw new Error('Invalid shared manifest');
    const references = new Set();
    let build;
    for (const item of evidences) {
        validateReleaseEvidence(item.evidence, item.evidence.assets, { requireTested: true });
        if (!digestPattern.test(item.sha256))
            throw new Error('Missing target evidence digest');
        const current = item.evidence.build;
        if (build && (build.gitSha !== current.gitSha || build.version !== current.version || build.channel !== current.channel || build.releaseTag !== item.evidence.releaseTag))
            throw new Error('Shared manifest mixes build identities');
        build = { ...current, releaseTag: item.evidence.releaseTag };
        for (const asset of item.evidence.assets)
            references.add(asset.name);
    }
    for (const name of manifest.references)
        if (!references.has(name))
            throw new Error(`Missing validated target for ${name}`);
    return { schemaVersion: 1, manifest: { name: manifest.name, sha256: manifest.sha256 }, targets: evidences.map(x => ({ name: evidenceFilename(x.evidence.build), sha256: x.sha256 })), at: evidences.flatMap(x => x.evidence.receipts.map(r => r.at)).sort().at(-1) };
}
/** Import only a complete native operator receipt; preserve the previous evidence file. */
export function importNativeAcceptance(evidence, receipt) {
    validateReleaseEvidence(evidence, evidence.assets);
    if (receipt?.status !== 'pass')
        throw new Error('Native acceptance must explicitly pass');
    if (JSON.stringify(receipt.build) !== JSON.stringify(evidence.build) || JSON.stringify(receipt.native?.build) !== JSON.stringify(evidence.build))
        throw new Error('Native build identity differs');
    if (!['fresh', 'migrated'].includes(receipt.profile) || receipt.native?.profileKind !== receipt.profile || receipt.native.assetSha256 !== receipt.assetSha256 || receipt.native.legalworkDevMode !== false || !evidence.assets.some(asset => installer(asset) && asset.sha256 === receipt.assetSha256))
        throw new Error('Native profile or final installer differs');
    if (!receipt.profileOwner || !receipt.operator || !url(receipt.evidenceUrl) || !Number.isFinite(Date.parse(receipt.at)) || receipt.native.signature?.status !== 'verified' || receipt.native.signature.method !== 'codesign-spctl-and-installer-tree')
        throw new Error('Native operator or signature proof missing');
    for (const scenario of REQUIRED_NATIVE_SCENARIOS) {
        const results = receipt.acceptance.filter(x => x.scenario === scenario && x.profile === receipt.profile && x.assetSha256 === receipt.assetSha256);
        if (results.length !== 1 || results[0].status !== 'pass' || !url(results[0].evidenceUrl))
            throw new Error('Native acceptance scenario missing');
    }
    const updated = structuredClone(evidence);
    updated.acceptance = updated.acceptance.filter(x => x.profile !== receipt.profile || x.assetSha256 !== receipt.assetSha256);
    updated.acceptance.push(...receipt.acceptance);
    updated.signing = { status: 'verified', evidenceUrl: receipt.evidenceUrl };
    const stateReceipt = state => ({ state, at: receipt.at, actor: receipt.operator, evidenceUrl: receipt.evidenceUrl, assetSha256: receipt.assetSha256 });
    if (!updated.receipts.some(x => x.state === 'signed' && x.assetSha256 === receipt.assetSha256))
        updated.receipts.push(stateReceipt('signed'));
    const both = REQUIRED_NATIVE_SCENARIOS.every(scenario => ['fresh', 'migrated'].every(profile => updated.acceptance.some(x => x.scenario === scenario && x.profile === profile && x.assetSha256 === receipt.assetSha256 && x.status === 'pass')));
    if (both && !updated.receipts.some(x => x.state === 'tested' && x.assetSha256 === receipt.assetSha256))
        updated.receipts.push(stateReceipt('tested'));
    validateReleaseEvidence(updated, updated.assets);
    return updated;
}
export function recordPublishedEvidence(evidence, { release, observedAssets, actor, at, evidenceUrl }) {
    if (release.isDraft !== false || release.tagName !== evidence.releaseTag)
        throw new Error('Published receipt requires the exact public, non-draft release');
    validateReleaseEvidence(evidence, observedAssets, { requireTested: true });
    const updated = structuredClone(evidence);
    for (const asset of evidence.assets)
        if (!updated.receipts.some(x => x.state === 'published' && x.assetSha256 === asset.sha256))
            updated.receipts.push({ state: 'published', at, actor, evidenceUrl, assetSha256: asset.sha256 });
    validateReleaseEvidence(updated, observedAssets, { requireTested: true });
    return updated;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command, ...args] = process.argv.slice(2);
    const arg = name => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
    if (command === 'record-published') {
        const { runGh } = await import('./immutable-upload.mjs');
        const { mkdtemp, rm } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const evidence = JSON.parse(await readFile(arg('evidence'), 'utf8'));
        const repo = process.env.RELEASE_REPOSITORY || process.env.GITHUB_REPOSITORY;
        if (!repo)
            throw new Error('Release repository required');
        const release = JSON.parse(await runGh(['release', 'view', evidence.releaseTag, '--repo', repo, '--json', 'tagName,isDraft']));
        const root = await mkdtemp(join(tmpdir(), 'lawoss-published-readback-'));
        try {
            for (const asset of evidence.assets)
                await runGh(['release', 'download', evidence.releaseTag, '--repo', repo, '--pattern', asset.name, '--dir', root]);
            const updated = recordPublishedEvidence(evidence, { release, observedAssets: await evidenceAssetsFromDirectory(evidence, root), actor: arg('actor'), at: new Date().toISOString(), evidenceUrl: arg('evidence-url') });
            await writeFile(arg('out'), `${JSON.stringify(updated, null, 2)}\n`, { flag: 'wx' });
        }
        finally {
            await rm(root, { recursive: true, force: true });
        }
    }
    else if (command === 'record-acceptance') {
        const evidence = JSON.parse(await readFile(arg('evidence'), 'utf8'));
        const receipt = JSON.parse(await readFile(arg('receipt'), 'utf8'));
        validateReleaseEvidence(evidence, await evidenceAssetsFromDirectory(evidence, resolve(arg('assets-dir'))));
        // The operator keeps redacted native captures. Verify every local capture before binding the receipt.
        for (const attachment of receipt.native?.attachments ?? [])
            if (sha256(await readFile(attachment.path)) !== attachment.sha256)
                throw new Error('Native capture bytes differ');
        const updated = importNativeAcceptance(evidence, receipt);
        await writeFile(arg('out'), `${JSON.stringify(updated, null, 2)}\n`, { flag: 'wx' });
    }
    else if (command === 'verify') {
        const evidence = JSON.parse(await readFile(arg('evidence'), 'utf8'));
        validateReleaseEvidence(evidence, await evidenceAssetsFromDirectory(evidence, resolve(arg('assets-dir'))), { requireTested: args.includes('--require-tested') });
        console.log(JSON.stringify({ status: 'verified-bytes', acceptance: args.includes('--require-tested') ? 'pass' : 'not-asserted', target: evidenceFilename(evidence.build) }));
    }
    else if (command === 'create') {
        const build = validateBuildInfo(JSON.parse(await readFile(arg('build'), 'utf8')));
        const root = resolve(arg('assets-dir'));
        if (build.platform === 'darwin') {
            const names = await readdir(root);
            if (names.includes('latest-mac.yml'))
                await copyFile(join(root, 'latest-mac.yml'), join(root, `latest-mac-${build.arch}.yml`));
        }
        const files = (await readdir(root)).filter(name => isElectronReleaseAsset(name) || (/^latest.*\.yml$/.test(name) && ownsAsset(build, name))).map(name => join(root, name));
        // Called after signing and all other byte-changing steps. No inference of signature or runtime PASS.
        const assets = await observeAssets(files);
        const evidence = createReleaseEvidence({ build, releaseTag: arg('release-tag'), assets, receipts: [{ state: 'built', at: new Date().toISOString(), actor: process.env.GITHUB_ACTOR ?? 'local', evidenceUrl: build.workflowRunUrl || arg('evidence-url') }], signing: { status: 'unverified', evidenceUrl: null }, acceptance: assets.filter(installer).flatMap(asset => REQUIRED_NATIVE_SCENARIOS.flatMap(scenario => ['fresh', 'migrated'].map(profile => ({ scenario, profile, assetSha256: asset.sha256, status: 'not-run', evidenceUrl: null })))) });
        const output = arg('out') ?? join(root, evidenceFilename(build));
        await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
        console.log(output);
    }
    else
        throw new Error('Usage: release-evidence.mjs create|verify --assets-dir <dir> ...');
}
