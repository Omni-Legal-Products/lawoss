import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

// Opakovaný beh (Re-run all jobs) alfy pre Windows: kroky `signing` a „Create immutable
// alpha prerelease“ sa spustia v bashi tak, ako sú vo workflowe, s falošným `gh`.
const desktopRequire = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
const YAML = desktopRequire('yaml');
const workflow = YAML.parse(readFileSync(new URL('../../.github/workflows/alpha-windows-x64.yml', import.meta.url), 'utf8'));
const job = workflow.jobs['publish-alpha-windows'];
const stepOf = (steps, name) => {
    const found = steps.filter(step => step.name === name);
    assert.equal(found.length, 1, name);
    return found[0];
};
const gateStep = stepOf(workflow.jobs.signing.steps, 'Require SignPath or an explicit unsigned internal build');
const createStep = stepOf(job.steps, 'Create immutable alpha prerelease');

const fakeGh = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const notesFile = opt('--notes-file');
appendFileSync(process.env.GH_LOG, JSON.stringify({ args, notes: notesFile ? readFileSync(notesFile, 'utf8') : null }) + '\\n');
const existing = process.env.EXISTING_RELEASE ? JSON.parse(process.env.EXISTING_RELEASE) : null;
if (args[0] !== 'release' || args[2] !== process.env.EXPECTED_TAG || opt('--repo') !== process.env.GITHUB_REPOSITORY) process.exit(3);
if (args[1] === 'view') {
    if (!existing) { console.error('release not found'); process.exit(1); }
    const field = [opt('--json'), opt('--jq')].join(' ');
    if (field === ' ') process.exit(0);
    if (field === 'isDraft .isDraft') { console.log(String(existing.isDraft)); process.exit(0); }
    if (field === 'name .name') { console.log(existing.name); process.exit(0); }
    process.exit(3);
}
process.exit(args[1] === 'edit' || args[1] === 'create' ? 0 : 3);
`;

const bash = (script, env) => {
    const root = mkdtempSync(join(tmpdir(), 'lawoss-alpha-windows-rerun-'));
    try {
        writeFileSync(join(root, 'gh'), fakeGh, { mode: 0o755 });
        writeFileSync(join(root, 'step.sh'), script);
        writeFileSync(join(root, 'output'), '');
        writeFileSync(join(root, 'gh.log'), '');
        writeFileSync(join(root, 'sha256.md'), '| Súbor | SHA-256 |\n| --- | --- |\n');
        // Rovnaké voľby ako `shell: bash` v GitHub Actions.
        const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', join(root, 'step.sh')], {
            encoding: 'utf8',
            env: {
                PATH: `${root}${delimiter}${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
                HOME: root, RUNNER_TEMP: root, GITHUB_OUTPUT: join(root, 'output'), GH_LOG: join(root, 'gh.log'),
                ASSET_HASHES: join(root, 'sha256.md'), ...env,
            },
        });
        const outputs = Object.fromEntries(readFileSync(join(root, 'output'), 'utf8').split('\n').filter(Boolean).map(line => line.split('=')));
        const calls = readFileSync(join(root, 'gh.log'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
        return { status: result.status, log: result.stdout + result.stderr, outputs, calls };
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
};

// Vstupy dispatchu ostávajú pri Re-run all jobs rovnaké; zmeniť sa môže konfigurácia SignPath.
const gate = (signpath, draft) => {
    const result = bash(gateStep.run, { SIGNPATH_PROJECT_SLUG: signpath, ALLOW_UNSIGNED_INTERNAL: 'true', PUBLISH: 'true', DRAFT: draft });
    assert.equal(result.status, 0, result.log);
    return result.outputs;
};

const version = '0.2.9-alpha.6.gabc1234';
const unsignedPrefix = 'NEPODPÍSANÉ – len interný tím · ';
const createRelease = (arch, state, existing) => bash(createStep.run, {
    GH_TOKEN: 'fixture', GITHUB_REPOSITORY: 'fixture/lawoss', GITHUB_SERVER_URL: 'https://github.example', GITHUB_RUN_ID: '1',
    GITHUB_SHA: 'a'.repeat(40), ALPHA_VERSION: version, ALPHA_ARCH: arch,
    ALPHA_RUN_RELEASE_TAG: `alpha-windows-${arch}-v0.2.9-alpha.6-abc1234`, EXPECTED_TAG: `alpha-windows-${arch}-v0.2.9-alpha.6-abc1234`,
    SIGNED: state.signed, DRAFT: state.draft, EXISTING_RELEASE: existing ? JSON.stringify(existing) : '',
});
const mutations = calls => calls.filter(call => call.args[1] !== 'view');

test('the release step reads signed and draft from the signing gate', () => {
    assert.equal(job.env.SIGNED, '${{ needs.signing.outputs.signed }}');
    assert.equal(job.env.DRAFT, '${{ needs.signing.outputs.draft }}');
    assert.deepEqual(job.strategy.matrix.include.map(entry => entry.arch), ['x64', 'arm64']);
    // Po zlyhaní kroku releasu sa nenahrajú assety ani neposunie ukazovateľ.
    for (const name of ['Upload Electron alpha updater assets', 'Update alpha updater pointer'])
        assert.doesNotMatch(String(stepOf(job.steps, name).if), /always\(\)|failure\(\)|cancelled\(\)/, name);
});

for (const arch of job.strategy.matrix.include.map(entry => entry.arch)) {
    for (const draftInput of ['false', 'true']) {
        for (const [first, second] of [['', ''], ['slug', 'slug'], ['', 'slug'], ['slug', '']]) {
            const signpath = slug => (slug ? 'SignPath' : 'no SignPath');
            test(`${arch} draft=${draftInput}: re-run ${signpath(first)} -> ${signpath(second)} keeps release name and assets consistent`, () => {
                const before = gate(first, draftInput);
                const after = gate(second, draftInput);
                const title = `LAWOSS Alpha ${version} (Windows ${arch})`;
                const created = createRelease(arch, before, null);
                assert.equal(created.status, 0, created.log);
                const [create] = mutations(created.calls);
                assert.equal(create.args[1], 'create');
                const createdTitle = create.args[create.args.indexOf('--title') + 1];
                assert.equal(createdTitle, before.signed === 'true' ? title : `${unsignedPrefix}${title}`);
                assert.equal(create.args.includes('--draft'), before.draft === 'true');
                assert.equal(create.notes.startsWith('> [!WARNING]\n> **NEPODPÍSANÝ build'), before.signed !== 'true');

                const rerun = createRelease(arch, after, { isDraft: before.draft === 'true', name: createdTitle });
                if (before.signed === after.signed && before.draft === after.draft) {
                    assert.equal(rerun.status, 0, rerun.log);
                    const [edit, ...rest] = mutations(rerun.calls);
                    assert.deepEqual(rest, []);
                    assert.equal(edit.args[1], 'edit');
                    assert.equal(edit.args[edit.args.indexOf('--title') + 1], createdTitle);
                    assert.equal(edit.notes, create.notes);
                    return;
                }
                // Iný podpis alebo koncept než prvý pokus: nič sa nepremenuje ani nevytvorí,
                // krok zlyhá a nasledujúce nahratie assetov sa nespustí.
                assert.equal(rerun.status, 1, rerun.log);
                assert.match(rerun.log, /::error title=Opakovaný beh s iným podpisom::/);
                assert.deepEqual(mutations(rerun.calls), []);
            });
        }
    }
}
