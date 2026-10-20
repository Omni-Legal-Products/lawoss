import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { evidenceFilename, sha256, validateReleaseEvidence } from './release-evidence.mjs';
import { publishImmutableFiles, runGh } from './immutable-upload.mjs';

const digestPattern = /^[a-f0-9]{64}$/;
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const evidenceSnapshotName = (build, digest) => evidenceFilename(build).replace(/\.json$/, `-sha256-${digest}.json`);

export function assertEvidenceExtension(previous, next) {
  validateReleaseEvidence(previous, previous.assets);
  validateReleaseEvidence(next, next.assets);
  for (const key of ['schemaVersion', 'build', 'releaseTag', 'assets']) {
    if (!same(previous[key], next[key])) throw new Error(`Evidence revision changes immutable identity/assets: ${key}`);
  }
  for (const receipt of previous.receipts) {
    if (!next.receipts.some(item => same(item, receipt))) throw new Error('Evidence revision loses an immutable receipt');
  }
  if (new Set(next.receipts.map(item => JSON.stringify(item))).size !== next.receipts.length) throw new Error('Duplicate evidence receipt replay');
  for (const result of previous.acceptance.filter(item => item.status === 'pass')) {
    if (!next.acceptance.some(item => same(item, result))) throw new Error('Evidence revision loses passing acceptance');
  }
  if (previous.signing.status === 'verified' && !same(previous.signing, next.signing)) throw new Error('Evidence revision replaces verified signing');
  if (previous.acceptanceHandoff && !same(previous.acceptanceHandoff, next.acceptanceHandoff)) throw new Error('Evidence revision replays another acceptance handoff');
}

async function releaseState(repo, tag, gh) {
  const raw = JSON.parse(await gh(['api', `repos/${repo}/releases/tags/${encodeURIComponent(tag)}`]));
  const state = {tagName:raw.tag_name,isDraft:raw.draft,assets:raw.assets};
  if (state.tagName !== tag || !Array.isArray(state.assets)) throw new Error('Exact metadata release tag unavailable');
  if (new Set(state.assets.map(item => item.name)).size !== state.assets.length) throw new Error('Ambiguous remote asset names');
  return state;
}
async function remoteBytes(repo, tag, name, root, gh) {
  await rm(join(root, name), { force: true });
  await gh(['release', 'download', tag, '--repo', repo, '--pattern', name, '--dir', root]);
  return readFile(join(root, name));
}
async function verifyChainBytes({ repo, tag, evidence, state, root, gh }) {
  validateReleaseEvidence(evidence, evidence.assets);
  const history = evidence.evidenceHistory ?? [];
  if (!Array.isArray(history) || history.length > 1000) throw new Error('Invalid evidence chain');
  const seen = new Set();
  let preceding;
  for (let index = 0; index < history.length; index++) {
    const item = history[index];
    if (!item || !digestPattern.test(item.sha256) || item.name !== evidenceSnapshotName(evidence.build, item.sha256) || seen.has(item.sha256)) throw new Error('Invalid evidence snapshot chain');
    seen.add(item.sha256);
    if (!state.assets.some(asset => asset.name === item.name)) throw new Error(`Missing evidence chain snapshot: ${item.name}`);
    const bytes = await remoteBytes(repo, tag, item.name, root, gh);
    if (sha256(bytes) !== item.sha256) throw new Error('Evidence snapshot collision or changed bytes');
    const snapshot = JSON.parse(bytes);
    if (!same(snapshot.evidenceHistory ?? [], history.slice(0, index))) throw new Error('Broken evidence snapshot history');
    if (preceding) assertEvidenceExtension(preceding, snapshot);
    preceding = snapshot;
  }
  if (preceding) assertEvidenceExtension(preceding, evidence);
}

/** Read-only guard used immediately before shared-manifest or pointer publication. */
export async function verifyEvidenceChain({ repo, tag, name, expectedSha256, gh = runGh }) {
  if (!/^release-evidence-(darwin|win32|linux)-(arm64|x64)\.json$/.test(name)) throw new Error('Not an exact canonical target evidence name');
  const root = await mkdtemp(join(tmpdir(), 'lawoss-evidence-chain-'));
  try {
    const state = await releaseState(repo, tag, gh);
    if (!state.assets.some(item => item.name === name)) throw new Error('Missing canonical evidence');
    const bytes = await remoteBytes(repo, tag, name, root, gh);
    if (expectedSha256 && sha256(bytes) !== expectedSha256) throw new Error('Stale canonical evidence precondition');
    const evidence = JSON.parse(bytes);
    if (evidenceFilename(evidence.build) !== name || evidence.releaseTag !== tag) throw new Error('Foreign canonical target identity');
    await verifyChainBytes({ repo, tag, evidence, state, root, gh });
    return { evidence, bytes, sha256: sha256(bytes) };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Recover the single last preserved canonical state after an interrupted exclusive upload. */
export async function recoverEvidenceSnapshot({repo,tag,name,gh=runGh}) {
  if(!/^release-evidence-(darwin|win32|linux)-(arm64|x64)\.json$/.test(name))throw new Error('Invalid recovery target');
  const root=await mkdtemp(join(tmpdir(),'lawoss-evidence-recovery-'));
  try {
    const state=await releaseState(repo,tag,gh);
    if(state.assets.some(asset=>asset.name===name))throw new Error('Canonical recovery requires absence');
    const prefix=name.replace(/\.json$/,'-sha256-');const candidates=[];
    for(const asset of state.assets.filter(asset=>asset.name.startsWith(prefix)&&asset.name.endsWith('.json'))){
      const bytes=await remoteBytes(repo,tag,asset.name,root,gh),digest=sha256(bytes),evidence=JSON.parse(bytes);
      if(asset.name!==evidenceSnapshotName(evidence.build,digest)||evidenceFilename(evidence.build)!==name||evidence.releaseTag!==tag)throw new Error('Recovery snapshot identity differs');
      await verifyChainBytes({repo,tag,evidence,state,root,gh});candidates.push({evidence,bytes,sha256:digest});
    }
    if(!candidates.length)return null;
    candidates.sort((a,b)=>(b.evidence.evidenceHistory?.length??0)-(a.evidence.evidenceHistory?.length??0));
    const latest=candidates[0],covered=new Set([latest.sha256,...(latest.evidence.evidenceHistory??[]).map(item=>item.sha256)]);
    if(candidates.some(item=>!covered.has(item.sha256)))throw new Error('Ambiguous or forked recovery snapshot chain');
    return latest;
  }finally{await rm(root,{recursive:true,force:true});}
}

/** Sole metadata effect owner. Old bytes are archived first; no upload ever uses --clobber. */
export async function publishEvidenceRevision({ path, repo, tag, expectedRemoteSha256 = null, gh = runGh }) {
  const inputBytes = await readFile(path);
  const input = JSON.parse(inputBytes);
  validateReleaseEvidence(input, input.assets);
  const name = evidenceFilename(input.build);
  if (basename(path) !== name || input.releaseTag !== tag) throw new Error('Metadata revision requires the exact canonical target name/tag');
  if (expectedRemoteSha256 !== null && !digestPattern.test(expectedRemoteSha256)) throw new Error('Invalid metadata precondition');
  const root = await mkdtemp(join(tmpdir(), 'lawoss-evidence-revision-'));
  try {
    let state = await releaseState(repo, tag, gh);
    let currentAsset = state.assets.find(item => item.name === name);
    let currentBytes = currentAsset ? await remoteBytes(repo, tag, name, root, gh) : null;
    if (currentBytes && sha256(currentBytes) === sha256(inputBytes)) {
      await verifyChainBytes({ repo, tag, evidence: input, state, root, gh });
      return { evidence: input, bytes: inputBytes, sha256: sha256(inputBytes) };
    }
    let previousBytes;
    if (expectedRemoteSha256 === null) {
      if (currentBytes) throw new Error('Stale canonical metadata precondition: create-only');
      if ((input.evidenceHistory ?? []).length) throw new Error('Cannot create canonical metadata with an unverified chain');
      const snapshotPrefix = name.replace(/\.json$/, '-sha256-');
      if (state.assets.some(asset => asset.name.startsWith(snapshotPrefix))) throw new Error('Existing target snapshots require explicit recovery; refusing a new evidence root');
      await publishImmutableFiles({ files: [path], tag, repo, gh });
      return verifyEvidenceChain({ repo, tag, name, expectedSha256: sha256(inputBytes), gh });
    }
    const snapshotName = evidenceSnapshotName(input.build, expectedRemoteSha256);
    if (currentBytes && sha256(currentBytes) === expectedRemoteSha256) previousBytes = currentBytes;
    else {
      if (!state.assets.some(item => item.name === snapshotName)) throw new Error('Stale canonical precondition or missing recovery snapshot');
      previousBytes = await remoteBytes(repo, tag, snapshotName, root, gh);
      if (sha256(previousBytes) !== expectedRemoteSha256) throw new Error('Evidence snapshot collision');
    }
    const previous = JSON.parse(previousBytes);
    assertEvidenceExtension(previous, input);
    await verifyChainBytes({ repo, tag, evidence: previous, state, root, gh });
    const priorHistory = previous.evidenceHistory ?? [];
    if (!same(input.evidenceHistory ?? [], priorHistory)) throw new Error('Caller cannot replace the evidence chain');
    const next = { ...input, evidenceHistory: [...priorHistory, { name: snapshotName, sha256: expectedRemoteSha256 }] };
    const nextBytes = encode(next);
    if (currentBytes && sha256(currentBytes) === sha256(nextBytes)) {
      await verifyChainBytes({ repo, tag, evidence: next, state, root, gh });
      return { evidence: next, bytes: nextBytes, sha256: sha256(nextBytes) };
    }
    if (currentBytes && sha256(currentBytes) !== expectedRemoteSha256) throw new Error('Stale canonical metadata precondition');
    // Validate every pre-existing snapshot collision before the first mutation.
    if (state.assets.some(item => item.name === snapshotName)) {
      if (sha256(await remoteBytes(repo, tag, snapshotName, root, gh)) !== expectedRemoteSha256) throw new Error('Evidence snapshot collision');
    } else {
      const snapshotPath = join(root, snapshotName);
      await writeFile(snapshotPath, previousBytes);
      await publishImmutableFiles({ files: [snapshotPath], tag, repo, gh });
    }
    // Recheck content and the exact asset ID after snapshot preservation. A concurrent
    // replacement gets a different ID. Delete only the captured ID, never a name.
    state = await releaseState(repo, tag, gh);
    const observed = state.assets.find(item => item.name === name);
    if (currentAsset) {
      if (!observed || observed.id !== currentAsset.id || sha256(await remoteBytes(repo, tag, name, root, gh)) !== expectedRemoteSha256) throw new Error('Canonical metadata raced its stale precondition');
      if (!Number.isSafeInteger(observed.id) || observed.id <= 0) throw new Error('Canonical asset ID unavailable');
      await gh(['api', `repos/${repo}/releases/assets/${observed.id}`, '--method', 'DELETE']);
    } else if (observed) throw new Error('Canonical metadata appeared during recovery');
    const nextPath = join(root, name);
    await writeFile(nextPath, nextBytes);
    // Exclusive create refuses a racing canonical writer. An interrupted upload is
    // recoverable from the immutable prior snapshot using the original precondition.
    await gh(['release', 'upload', tag, nextPath, '--repo', repo]);
    return verifyEvidenceChain({ repo, tag, name, expectedSha256: sha256(nextBytes), gh });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
