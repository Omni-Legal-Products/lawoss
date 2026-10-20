import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishImmutableFiles } from './immutable-upload.mjs';
test('reject changed existing bytes before uploading any payload; identical repeat is idempotent', async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'immutable-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const a = join(dir, 'a.exe'), b = join(dir, 'b.exe');
    await writeFile(a, 'final a');
    await writeFile(b, 'final b');
    const remote = new Map([['b.exe', Buffer.from('changed')]]);
    const calls = [];
    const gh = async (args) => { calls.push(args); if (args[1] === 'view')
        return JSON.stringify({ isDraft: true, assets: [...remote.keys()].map(name => ({ name })) }); if (args[1] === 'download') {
        await writeFile(join(args[args.indexOf('--dir') + 1], args[args.indexOf('--pattern') + 1]), remote.get(args[args.indexOf('--pattern') + 1]));
        return '';
    } if (args[1] === 'upload') {
        for (const file of args.slice(3, args.indexOf('--repo')))
            remote.set(file.split('/').at(-1), await readFile(file));
        return '';
    } throw new Error('Unexpected gh'); };
    await assert.rejects(publishImmutableFiles({ files: [a, b], tag: 'fixture', repo: 'fixture/repo', gh }), /immutable/i);
    assert.equal(calls.filter(x => x[1] === 'upload').length, 0);
    remote.set('b.exe', Buffer.from('final b'));
    await publishImmutableFiles({ files: [a, b], tag: 'fixture', repo: 'fixture/repo', gh });
    assert.equal(calls.filter(x => x[1] === 'upload').length, 1);
    assert.ok(calls.every(x => !x.includes('--clobber')));
    await publishImmutableFiles({ files: [a, b], tag: 'fixture', repo: 'fixture/repo', gh });
    assert.equal(calls.filter(x => x[1] === 'upload').length, 1);
});
test('changed uploaded bytes are detected by exact tag readback', async (t) => { const dir = await mkdtemp(join(tmpdir(), 'readback-')); t.after(() => rm(dir, { recursive: true, force: true })); const file = join(dir, 'a.exe'); await writeFile(file, 'final'); const gh = async (args) => { if (args[1] === 'view')
    return JSON.stringify({ isDraft: false, assets: [] }); if (args[1] === 'upload')
    return ''; if (args[1] === 'download') {
    await writeFile(join(args[args.indexOf('--dir') + 1], 'a.exe'), 'changed');
    return '';
} throw new Error('Unexpected gh'); }; await assert.rejects(publishImmutableFiles({ files: [file], tag: 'exact-run-tag', repo: 'fixture/repo', gh }), /readback/i); });
