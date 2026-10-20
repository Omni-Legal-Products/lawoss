#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runGh } from './immutable-upload.mjs';
import { observeAssets, validateReleaseEvidence } from './release-evidence.mjs';
function compareVersions(left, right) {
    const parse = value => { const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value); if (!match)
        throw new Error('Invalid semver'); const pre = match[4]?.split('.') ?? []; if (pre.some(x => !x || /^0\d+$/.test(x)))
        throw new Error('Invalid semver'); return { core: match.slice(1, 4).map(BigInt), pre }; };
    const a = parse(left), b = parse(right);
    for (let i = 0; i < 3; i++)
        if (a.core[i] !== b.core[i])
            return a.core[i] > b.core[i] ? 1 : -1;
    if (!a.pre.length || !b.pre.length)
        return a.pre.length === b.pre.length ? 0 : !a.pre.length ? 1 : -1;
    for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
        if (a.pre[i] === b.pre[i])
            continue;
        const an = /^\d+$/.test(a.pre[i]), bn = /^\d+$/.test(b.pre[i]);
        if (an !== bn)
            return an ? -1 : 1;
        return an ? (BigInt(a.pre[i]) > BigInt(b.pre[i]) ? 1 : -1) : a.pre[i] > b.pre[i] ? 1 : -1;
    }
    return Math.sign(a.pre.length - b.pre.length);
}
export function validateChannelPromotion({ evidence, release, observedAssets, pointerTag, manifestName, currentVersion }) {
    if (release.isDraft !== false)
        throw new Error('Draft release cannot move a public pointer');
    if (release.tagName !== evidence.releaseTag)
        throw new Error('Exact release tag differs');
    validateReleaseEvidence(evidence, observedAssets, { requireTested: true });
    const { platform, arch, version, channel } = evidence.build;
    const target = platform === 'win32' ? { tag: 'alpha-windows-latest', manifest: arch === 'arm64' ? 'latest-arm64.yml' : 'latest.yml' } : platform === 'darwin' && arch === 'arm64' ? { tag: 'alpha-macos-latest', manifest: 'latest-mac.yml' } : null;
    if (channel !== 'alpha' || !target || target.tag !== pointerTag || target.manifest !== manifestName)
        throw new Error('Pointer target architecture differs');
    for (const asset of evidence.assets)
        if (!evidence.receipts.some(x => x.state === 'published' && x.assetSha256 === asset.sha256))
            throw new Error(`Missing published receipt: ${asset.name}`);
    if (currentVersion && compareVersions(version, currentVersion) <= 0)
        throw new Error('Candidate must be newer; downgrade and equal-version refresh are refused');
    return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    const arg = name => { const i = args.indexOf(`--${name}`); if (i < 0 || !args[i + 1])
        throw new Error(`Missing --${name}`); return args[i + 1]; };
    const evidence = JSON.parse(await readFile(arg('evidence'), 'utf8'));
    const repo = process.env.RELEASE_REPOSITORY || process.env.GITHUB_REPOSITORY;
    if (!repo)
        throw new Error('Release repository required');
    const release = JSON.parse(await runGh(['release', 'view', evidence.releaseTag, '--repo', repo, '--json', 'tagName,isDraft']));
    const root = await mkdtemp(join(tmpdir(), 'lawoss-channel-verification-'));
    try {
        for (const asset of evidence.assets)
            await runGh(['release', 'download', evidence.releaseTag, '--repo', repo, '--pattern', asset.name, '--dir', root]);
        const pointerTag = arg('pointer-tag'), manifestName = arg('manifest');
        let currentVersion;
        // Read the current pointer fail-closed. Authentication or missing metadata is never first-release proof.
        const pointerRoot = join(root, 'pointer');
        await import('node:fs/promises').then(fs => fs.mkdir(pointerRoot));
        await runGh(['release', 'download', pointerTag, '--repo', repo, '--pattern', manifestName, '--dir', pointerRoot]);
        const text = await readFile(join(pointerRoot, manifestName), 'utf8');
        currentVersion = text.match(/^version:\s*['"]?([^'"\r\n]+)['"]?\s*$/m)?.[1];
        if (!currentVersion) throw new Error('Current pointer version unavailable');
        validateChannelPromotion({ evidence, release, observedAssets: await observeAssets(evidence.assets.map(asset => join(root, asset.name))), pointerTag, manifestName, currentVersion });
        console.log('Verified exact public payload and channel promotion gates; pointer unchanged');
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
}
