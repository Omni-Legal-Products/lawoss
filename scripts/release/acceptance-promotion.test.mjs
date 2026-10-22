import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promoteAlphaTargets, publishDraftedPointers } from './acceptance-promotion.mjs';
import { sha256 } from './release-evidence.mjs';

const TAG = 'alpha-windows-latest';
const MANIFEST = { x64: 'latest.yml', arm64: 'latest-arm64.yml' };
// Fake shared Windows pointer: x64 and arm64 write their own manifest into the same release.
function windowsPointer({ draft }) {
  const state = { draft, assets: new Map([['latest.yml', 'version: 0.1.15-alpha.2\n'], ['latest-arm64.yml', 'version: 0.1.15-alpha.2\n']]) };
  const log = [];
  const gh = async args => {
    assert.equal(args[2], TAG);
    log.push(args[1]);
    if (args[1] === 'view') return JSON.stringify({ tagName: TAG, isDraft: state.draft, assets: [...state.assets.keys()].map(name => ({ name })) });
    if (args[1] === 'download') { const name = args[args.indexOf('--pattern') + 1]; await writeFile(join(args[args.indexOf('--dir') + 1], name), state.assets.get(name)); return ''; }
    if (args[1] === 'edit') { if (args.includes('--draft=false')) state.draft = false; return ''; }
    throw new Error(`Unexpected gh ${args.join(' ')}`);
  };
  const promoteTarget = async ({ item }) => {
    if (item.fail) throw new Error(`${item.arch} target refused`);
    const bytes = `version: 0.3.0-alpha.1\n# ${item.arch}\n`;
    const draftBefore = state.draft;
    state.assets.set(MANIFEST[item.arch], bytes);
    log.push(`promote-${item.arch}`);
    return { pointerTag: TAG, manifestName: MANIFEST[item.arch], sha256: sha256(bytes), draft: draftBefore };
  };
  return { state, log, gh, promoteTarget };
}

test('a drafted shared Windows pointer is published once, only after both x64 and arm64', async () => {
  const p = windowsPointer({ draft: true });
  await promoteAlphaTargets({ items: [{ arch: 'x64' }, { arch: 'arm64' }], repo: 'fixture/repo', gh: p.gh, promoteTarget: p.promoteTarget });
  assert.equal(p.state.draft, false);
  assert.deepEqual(p.log.filter(x => x === 'edit'), ['edit']);
  assert.ok(p.log.indexOf('edit') > p.log.indexOf('promote-arm64'), 'published after the last target');
});

test('a failed arm64 target leaves the drafted Windows pointer a draft', async () => {
  const p = windowsPointer({ draft: true });
  await assert.rejects(promoteAlphaTargets({ items: [{ arch: 'x64' }, { arch: 'arm64', fail: true }], repo: 'fixture/repo', gh: p.gh, promoteTarget: p.promoteTarget }), /arm64 target refused/);
  assert.equal(p.state.draft, true);
  assert.ok(!p.log.includes('edit'));
});

test('x64 alone cannot publish a drafted Windows pointer that still holds the old arm64 manifest', async () => {
  const p = windowsPointer({ draft: true });
  const x64 = await p.promoteTarget({ item: { arch: 'x64' } });
  await assert.rejects(publishDraftedPointers({ promoted: [x64], repo: 'fixture/repo', gh: p.gh }), /did not verify \(latest-arm64\.yml\); it stays a draft/);
  assert.equal(p.state.draft, true);
  assert.ok(!p.log.includes('edit'));
});

test('a pointer published by someone else in the meantime and a public pointer get no edit', async () => {
  const p = windowsPointer({ draft: true });
  const promoted = [await p.promoteTarget({ item: { arch: 'x64' } }), await p.promoteTarget({ item: { arch: 'arm64' } })];
  p.state.draft = false;
  await publishDraftedPointers({ promoted, repo: 'fixture/repo', gh: p.gh });
  assert.ok(!p.log.includes('edit'));
  const q = windowsPointer({ draft: false });
  await promoteAlphaTargets({ items: [{ arch: 'x64' }, { arch: 'arm64' }], repo: 'fixture/repo', gh: q.gh, promoteTarget: q.promoteTarget });
  assert.deepEqual(q.log, ['promote-x64', 'promote-arm64']);
});

test('a pointer drafted between the x64 and arm64 writes is published after both, counting the x64 write as verified', async () => {
  const p = windowsPointer({ draft: false });
  const promoteTarget = async args => { const result = await p.promoteTarget(args); if (args.item.arch === 'x64') p.state.draft = true; return result; };
  await promoteAlphaTargets({ items: [{ arch: 'x64' }, { arch: 'arm64' }], repo: 'fixture/repo', gh: p.gh, promoteTarget });
  assert.equal(p.state.draft, false);
  assert.deepEqual(p.log.filter(x => x === 'edit'), ['edit']);
});
