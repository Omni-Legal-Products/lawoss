#!/usr/bin/env node
import { runMacAcceptance } from './release-acceptance-macos.mjs';
import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readPackagedBuildInfo } from '../electron/build-info.mjs';
import { REQUIRED_NATIVE_SCENARIOS, sha256, validateReleaseEvidence } from '../../../scripts/release/release-evidence.mjs';
const markerName = '.lawoss-release-acceptance-profile.json';
async function ownedProfile(root, kind) {
    const path = resolve(root);
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || path === homedir())
        throw new Error('Expected an owned synthetic acceptance profile');
    let marker;
    try {
        marker = JSON.parse(await readFile(join(path, markerName), 'utf8'));
    }
    catch {
        throw new Error('Refusing an unowned or normal profile');
    }
    if (marker.schemaVersion !== 1 || marker.synthetic !== true || marker.root !== await realpath(path) || marker.kind !== kind || typeof marker.owner !== 'string')
        throw new Error('Acceptance profile ownership or kind differs');
    return marker;
}
export async function prepareAcceptanceProfile({ root, kind, migrateFrom }) {
    if (!['fresh', 'migrated'].includes(kind))
        throw new Error('Invalid profile kind');
    const path = resolve(root);
    let source;
    let baseline;
    if (kind === 'migrated') {
        if (!migrateFrom)
            throw new Error('Migration requires an old synthetic profile');
        source = await ownedProfile(migrateFrom, 'fresh');
        try {
            await lstat(join(migrateFrom, '.acceptance-running.lock'));
            throw new Error('Cannot copy a running profile');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        try {
            baseline = JSON.parse(await readFile(join(migrateFrom, '.native-acceptance-baseline.json'), 'utf8'));
        }
        catch { /* A missing historical baseline remains explicitly unverified. */ }
        if (path === source.root || path.startsWith(`${source.root}/`))
            throw new Error('Migration target must be separate');
    }
    // Exclusive creation refuses to adopt any existing directory or ordinary user profile.
    await mkdir(path, { recursive: false, mode: 0o700 });
    if (source)
        await cp(source.root, path, { recursive: true, force: false, errorOnExist: false, filter: src => basename(src) !== markerName });
    const marker = { schemaVersion: 1, synthetic: true, root: await realpath(path), kind, owner: randomUUID(), migratedFrom: source ? { root: source.root, owner: source.owner, baseline: baseline ?? null } : null };
    await writeFile(join(path, markerName), `${JSON.stringify(marker, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return marker;
}
/** Native adapter contract. JSON alone cannot create PASS. */
export function validateNativeObservation(observed, expected) {
    if (JSON.stringify(observed.build) !== JSON.stringify(expected.build) || observed.legalworkDevMode !== false)
        throw new Error('Running packaged build differs');
    if (observed.profileKind !== expected.profileKind)
        throw new Error('Native profile differs');
    if (observed.assetSha256 !== expected.assetSha256)
        throw new Error('Native installer digest differs');
    for (const scenario of REQUIRED_NATIVE_SCENARIOS)
        if (observed.scenarios?.filter(x => x.scenario === scenario && x.status === 'pass').length !== 1)
            throw new Error(`Missing native scenario: ${scenario}`);
}
export async function runReleaseAcceptance({ installedApp, asset, evidence, profileKind, profileRoot, output, manual = false, evidenceUrl, operator, adapter = runMacAcceptance }) {
    if (!['fresh', 'migrated'].includes(profileKind))
        throw new Error('Expected fresh or migrated profile');
    const profile = await ownedProfile(profileRoot, profileKind);
    const bytes = await readFile(asset);
    const expected = evidence.assets.find(x => x.name === basename(asset));
    if (!expected || sha256(bytes) !== expected.sha256 || bytes.length !== expected.size)
        throw new Error('Installer digest or final bytes differ');
    validateReleaseEvidence(evidence, evidence.assets);
    const resourcesPath = evidence.build.platform === 'darwin' ? join(installedApp, 'Contents/Resources') : join(dirname(installedApp), 'resources');
    const embedded = await readPackagedBuildInfo({ resourcesPath, version: evidence.build.version, platform: evidence.build.platform, arch: evidence.build.arch });
    const reasons = [];
    let observed;
    if (profileKind === 'migrated' && (!profile.migratedFrom?.baseline || profile.migratedFrom.baseline.status !== 'pass' || profile.migratedFrom.baseline.profileOwner !== profile.migratedFrom.owner || profile.migratedFrom.baseline.build?.version === evidence.build.version))
        reasons.push('supported-old-profile-baseline-not-proven');
    if (!embedded || JSON.stringify(embedded) !== JSON.stringify(evidence.build))
        reasons.push('installed-build-identity-unavailable-or-different');
    if (process.platform !== evidence.build.platform || process.arch !== evidence.build.arch)
        reasons.push('target-platform-unavailable');
    if (evidence.build.platform !== 'darwin')
        reasons.push('native-adapter-unavailable-for-target');
    const lease = join(profileRoot, '.acceptance-running.lock');
    await writeFile(lease, JSON.stringify({ owner: profile.owner, pid: process.pid }), { flag: 'wx', mode: 0o600 });
    try {
        if (!reasons.length) {
            try {
                observed = await adapter({ installedApp, asset, evidence, profileKind, profileRoot, manual, evidenceUrl, operator });
            }
            catch (error) {
                reasons.push('native-preflight-failed');
            }
        }
        const acceptance = REQUIRED_NATIVE_SCENARIOS.map(scenario => {
            const result = observed?.scenarios.find(item => item.scenario === scenario);
            return { scenario, profile: profileKind, assetSha256: expected.sha256, status: result?.status ?? 'blocked', evidenceUrl: result?.evidenceUrl ?? null };
        });
        const allPassed = acceptance.every(result => result.status === 'pass');
        if (allPassed) {
            validateNativeObservation(observed, { build: evidence.build, profileKind, assetSha256: expected.sha256 });
            await writeFile(join(profileRoot, '.native-acceptance-baseline.json'), JSON.stringify({ status: 'pass', build: evidence.build, assetSha256: expected.sha256, profileOwner: profile.owner, evidenceUrl }), 'utf8');
        }
        if (!allPassed && !reasons.length)
            reasons.push('native-scenarios-incomplete');
        const result = { schemaVersion: 1, status: allPassed ? 'pass' : acceptance.some(result => result.status === 'fail') ? 'fail' : 'blocked', build: evidence.build, profile: profileKind, profileOwner: profile.owner, assetSha256: expected.sha256, reasons, acceptance,
            native: observed ?? null, operator: operator ?? null, evidenceUrl: evidenceUrl ?? null, at: new Date().toISOString() };
        await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        return result;
    }
    finally {
        await import('node:fs/promises').then(fs => fs.rm(lease, { force: true }));
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2).filter(x => x !== '--');
    const arg = name => { const i = args.indexOf(`--${name}`); if (i < 0 || !args[i + 1])
        throw new Error(`Missing --${name}`); return args[i + 1]; };
    if (args.includes('--prepare-profile'))
        await prepareAcceptanceProfile({ root: arg('profile-root'), kind: arg('profile-kind'), migrateFrom: args.includes('--migrate-from') ? arg('migrate-from') : undefined });
    else {
        const result = await runReleaseAcceptance({ installedApp: arg('installed-app'), asset: arg('asset'), evidence: JSON.parse(await readFile(arg('evidence'), 'utf8')), profileKind: arg('profile-kind'), profileRoot: arg('profile-root'), output: arg('output'), manual: args.includes('--manual'), evidenceUrl: args.includes('--evidence-url') ? arg('evidence-url') : undefined, operator: args.includes('--operator') ? arg('operator') : undefined });
        console.error(`${result.status.toUpperCase()}: ${result.reasons.join(', ')}`);
        process.exitCode = result.status === 'pass' ? 0 : result.status === 'fail' ? 1 : 2;
    }
}
