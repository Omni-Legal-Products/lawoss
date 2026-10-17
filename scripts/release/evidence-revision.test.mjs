import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { publishEvidenceRevision, verifyEvidenceChain, evidenceSnapshotName, recoverEvidenceSnapshot } from './evidence-revision.mjs';
import { createReleaseEvidence, evidenceFilename, sha256 } from './release-evidence.mjs';

import { initialEvidence, fakeGh } from './release-test-fixtures.mjs';
function extension(e){return {...structuredClone(e),receipts:[...e.receipts,{state:'signed',at:'2026-10-17T00:01:00Z',actor:'operator',evidenceUrl:'https://example.invalid/sign',assetSha256:e.assets[0].sha256}],signing:{status:'verified',evidenceUrl:'https://example.invalid/sign'}};}
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'evidence-revision-'));t.after(()=>rm(root,{recursive:true,force:true}));const e=initialEvidence(),name=evidenceFilename(e.build),old=Buffer.from(JSON.stringify(e));const remote=fakeGh();remote.put(name,old);const path=join(root,name);await writeFile(path,JSON.stringify(extension(e)));return{root,e,name,old,remote,path};}
test('archives exact old canonical bytes before extending metadata; retry is idempotent and payload untouched',async t=>{const f=await fixture(t),payload=f.e.assets[0].name;f.remote.put(payload,'final');const result=await publishEvidenceRevision({path:f.path,repo:'fixture/repo',tag:f.e.releaseTag,expectedRemoteSha256:sha256(f.old),gh:f.remote.gh});assert.equal(f.remote.assets.get(evidenceSnapshotName(f.e.build,sha256(f.old))).bytes.toString(),f.old.toString());assert.deepEqual(f.remote.effects.map(x=>x[0]),['upload','delete','upload']);assert.equal(f.remote.assets.get(payload).bytes.toString(),'final');await verifyEvidenceChain({repo:'fixture/repo',tag:f.e.releaseTag,name:f.name,expectedSha256:result.sha256,gh:f.remote.gh});const count=f.remote.effects.length;await publishEvidenceRevision({path:f.path,repo:'fixture/repo',tag:f.e.releaseTag,expectedRemoteSha256:sha256(f.old),gh:f.remote.gh});assert.equal(f.remote.effects.length,count);});
test('foreign target/assets and removed receipts fail before effects',async t=>{for(const change of [e=>({...e,build:{...e.build,gitSha:'b'.repeat(40)}}),e=>({...e,assets:e.assets.map(a=>({...a,sha256:sha256('changed')}))}),e=>({...e,receipts:[]})]){const f=await fixture(t);await writeFile(f.path,JSON.stringify(change(extension(f.e))));await assert.rejects(publishEvidenceRevision({path:f.path,repo:'fixture/repo',tag:f.e.releaseTag,expectedRemoteSha256:sha256(f.old),gh:f.remote.gh}),/identity|asset|receipt|revision/i);assert.equal(f.remote.effects.length,0);}});
test('snapshot collision, stale precondition and raced canonical refuse replacement',async t=>{const f=await fixture(t);f.remote.put(evidenceSnapshotName(f.e.build,sha256(f.old)),'collision');await assert.rejects(publishEvidenceRevision({path:f.path,repo:'fixture/repo',tag:f.e.releaseTag,expectedRemoteSha256:sha256(f.old),gh:f.remote.gh}),/snapshot|collision/i);assert.equal(f.remote.effects.length,0);await assert.rejects(publishEvidenceRevision({path:f.path,repo:'fixture/repo',tag:f.e.releaseTag,expectedRemoteSha256:'b'.repeat(64),gh:f.remote.gh}),/precondition|snapshot|stale/i);});
test('failed canonical upload resumes from preserved exact snapshot; missing chain never verifies',async t=>{const f=await fixture(t);let fail=true;f.remote.setHook(args=>{if(fail&&args[1]==='upload'&&basename(args[3])===f.name){fail=false;throw new Error('Fixture transport failure');}});await assert.rejects(publishEvidenceRevision({path:f.path,repo:'fixture/repo',tag:f.e.releaseTag,expectedRemoteSha256:sha256(f.old),gh:f.remote.gh}),/transport/);assert.equal(f.remote.assets.has(f.name),false);const result=await publishEvidenceRevision({path:f.path,repo:'fixture/repo',tag:f.e.releaseTag,expectedRemoteSha256:sha256(f.old),gh:f.remote.gh});f.remote.assets.delete(evidenceSnapshotName(f.e.build,sha256(f.old)));await assert.rejects(verifyEvidenceChain({repo:'fixture/repo',tag:f.e.releaseTag,name:f.name,expectedSha256:result.sha256,gh:f.remote.gh}),/chain|snapshot|Missing/i);});

test('canonical replacement during snapshot preservation is detected before deleting either writer',async t=>{
 const f=await fixture(t);const raced=Buffer.from(JSON.stringify({...f.e,receipts:[...f.e.receipts,{state:'built',at:'2026-10-17T03:00:00Z',actor:'other writer',evidenceUrl:'https://example.invalid/other'}]}));
 let once=true;f.remote.setHook(args=>{if(once&&args[1]==='upload'&&basename(args[3]).includes('-sha256-')){once=false;f.remote.put(f.name,raced);}});
 await assert.rejects(publishEvidenceRevision({path:f.path,repo:'fixture/repo',tag:f.e.releaseTag,expectedRemoteSha256:sha256(f.old),gh:f.remote.gh}),/raced|stale/i);
 assert.equal(f.remote.assets.get(f.name).bytes.toString(),raced.toString());assert.ok(!f.remote.effects.some(effect=>effect[0]==='delete'));
});


test('create-only refuses reseeding a complete preserved target chain after canonical upload interruption', async t => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-no-reseed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = fakeGh(), initial = initialEvidence(), name = evidenceFilename(initial.build), path = join(root, name);
  await writeFile(path, JSON.stringify(initial));
  const first = await publishEvidenceRevision({ path, repo: 'fixture/repo', tag: initial.releaseTag, gh: remote.gh });
  const next = structuredClone(initial);
  next.receipts.push({ ...next.receipts[0], at: '2026-10-18T00:00:00Z' });
  await writeFile(path, JSON.stringify(next));
  const second = await publishEvidenceRevision({ path, repo: 'fixture/repo', tag: initial.releaseTag, expectedRemoteSha256: first.sha256, gh: remote.gh });
  // Exact state left after archiving the canonical and interrupting its replacement.
  remote.put(evidenceSnapshotName(second.evidence.build, second.sha256), second.bytes);
  remote.assets.delete(name);
  const recovered = await recoverEvidenceSnapshot({ repo: 'fixture/repo', tag: initial.releaseTag, name, gh: remote.gh });
  assert.equal(recovered.evidence.receipts.length, 2);
  assert.equal(remote.assets.size, 2);
  const before = [...remote.assets].map(([assetName, asset]) => [assetName, asset.id, sha256(asset.bytes)]);
  const effects = remote.effects.length;
  await writeFile(path, JSON.stringify(initial));
  await assert.rejects(publishEvidenceRevision({ path, repo: 'fixture/repo', tag: initial.releaseTag, gh: remote.gh }), /snapshot.*recover|recover.*snapshot/i);
  assert.equal(remote.effects.length, effects);
  assert.deepEqual([...remote.assets].map(([assetName, asset]) => [assetName, asset.id, sha256(asset.bytes)]), before);
  assert.equal(remote.assets.has(name), false);
  // Recovery still succeeds with the last preserved state and its explicit digest.
  await writeFile(path, recovered.bytes);
  const restored = await publishEvidenceRevision({ path, repo: 'fixture/repo', tag: initial.releaseTag, expectedRemoteSha256: recovered.sha256, gh: remote.gh });
  assert.equal(restored.evidence.receipts.length, 2);
  assert.equal(restored.evidence.evidenceHistory.length, 2);
});

test('create-only refuses malformed or forked target snapshot namespaces without mutations', async t => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-snapshot-refusal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const initial = initialEvidence(), name = evidenceFilename(initial.build), path = join(root, name);
  await writeFile(path, JSON.stringify(initial));
  for (const malformed of [true, false]) {
    const remote = fakeGh();
    if (malformed) remote.put(name.replace(/\.json$/, '-sha256-invalid.json'), 'malformed snapshot');
    else {
      const first = Buffer.from(JSON.stringify(initial));
      const fork = { ...initial, receipts: [...initial.receipts, { ...initial.receipts[0], at: '2026-10-18T01:00:00Z' }] };
      const second = Buffer.from(JSON.stringify(fork));
      remote.put(evidenceSnapshotName(initial.build, sha256(first)), first);
      remote.put(evidenceSnapshotName(initial.build, sha256(second)), second);
      await assert.rejects(recoverEvidenceSnapshot({ repo: 'fixture/repo', tag: initial.releaseTag, name, gh: remote.gh }), /ambiguous|forked/i);
    }
    await assert.rejects(publishEvidenceRevision({ path, repo: 'fixture/repo', tag: initial.releaseTag, gh: remote.gh }), /snapshot.*recover|recover.*snapshot/i);
    assert.equal(remote.effects.length, 0);
    assert.equal(remote.assets.has(name), false);
  }
});

test('genuine target first creation and exact retry remain valid beside another target history', async t => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-new-target-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = fakeGh(), initial = initialEvidence(), name = evidenceFilename(initial.build), path = join(root, name);
  remote.put('release-evidence-darwin-x64-sha256-invalid.json', 'other target snapshot');
  await writeFile(path, JSON.stringify(initial));
  const first = await publishEvidenceRevision({ path, repo: 'fixture/repo', tag: initial.releaseTag, gh: remote.gh });
  assert.equal(first.evidence.evidenceHistory?.length ?? 0, 0);
  const effects = remote.effects.length;
  const retry = await publishEvidenceRevision({ path, repo: 'fixture/repo', tag: initial.releaseTag, gh: remote.gh });
  assert.equal(retry.sha256, first.sha256);
  assert.equal(remote.effects.length, effects);
});
