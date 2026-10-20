#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { validateBuildInfo } from '../../apps/desktop/electron/build-info.mjs';
export function createBuildInfo(input) {
    return validateBuildInfo({ schemaVersion: 1, product: 'lawoss-desktop', ...input });
}
export function targetFromTriple(triple) {
    const arch = triple?.startsWith('aarch64-') ? 'arm64' : triple?.startsWith('x86_64-') ? 'x64' : null;
    const platform = triple?.includes('apple-darwin') ? 'darwin' : triple?.includes('windows') ? 'win32' : triple?.includes('linux') ? 'linux' : null;
    if (!arch || !platform)
        throw new Error(`Unsupported build target: ${triple}`);
    return { platform, arch };
}
const packagePaths = ['apps/app/package.json', 'apps/desktop/package.json', 'apps/orchestrator/package.json', 'apps/server/package.json', 'apps/opencode-router/package.json'];
/** Allow only the exact apply-version transformation, never an arbitrary dirty package. */
export function assertReleaseSource(root, version) {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
    const paths = git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean);
    for (const entry of paths) {
        const path = entry.slice(3);
        if (path === 'pnpm-lock.yaml' && !entry.startsWith('??')) {
            const before = git('show', 'HEAD:pnpm-lock.yaml');
            const after = readFileSync(resolve(root, path), 'utf8').trimEnd();
            if (after.split(version).join('0.0.0') !== before)
                throw new Error('Unexpected release source changes: pnpm-lock.yaml');
            continue;
        }
        if (!packagePaths.includes(path) || entry.startsWith('??'))
            throw new Error(`Release source is dirty: ${path}`);
        const expected = JSON.parse(git('show', `HEAD:${path}`));
        expected.version = version;
        if (path === 'apps/desktop/package.json')
            expected.opencodeRouterVersion = version;
        if (path === 'apps/orchestrator/package.json') {
            expected.dependencies['legalwork-server'] = version;
            expected.dependencies['opencode-router'] = version;
        }
        const observed = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
        if (JSON.stringify(observed) !== JSON.stringify(expected))
            throw new Error(`Unexpected release source changes: ${path}`);
    }
    return git('rev-parse', 'HEAD');
}
export function writeBuildInfoForCheckout({ root, out, version, platform, arch, channel, buildEpoch = undefined, workflowRunUrl = '', release = true }) {
    let gitSha;
    try {
        gitSha = assertReleaseSource(root, version);
    }
    catch (error) {
        if (release)
            throw error;
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, 'null\n');
        return null;
    }
    const epoch = buildEpoch ?? execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const info = createBuildInfo({ version, gitSha, buildEpoch: epoch, platform, arch, channel, workflowRunUrl });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(info, null, 2)}\n`);
    return info;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    const arg = name => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const version = arg('version') ?? JSON.parse(readFileSync(resolve(root, 'apps/desktop/package.json'), 'utf8')).version;
    if (args.includes('--assert-clean')) {
        assertReleaseSource(root, version);
    }
    else {
        const info = writeBuildInfoForCheckout({ root, out: resolve(arg('out') ?? 'apps/desktop/resources/build-info.json'), version, platform: arg('platform'), arch: arg('arch'), channel: arg('channel') ?? 'stable', buildEpoch: arg('build-epoch'), workflowRunUrl: arg('workflow-run-url') ?? '', release: !args.includes('--development') });
        if (arg('git-sha') && arg('git-sha') !== info?.gitSha)
            throw new Error('--git-sha differs from the checked-out source');
        console.log(JSON.stringify(info));
    }
}
