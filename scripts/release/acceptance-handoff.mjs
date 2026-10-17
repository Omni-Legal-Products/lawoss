#!/usr/bin/env node
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { evidenceFilename, evidenceAssetsFromDirectory, importNativeAcceptance, observeAssets, recordPublishedEvidence, sha256, validateReleaseEvidence } from './release-evidence.mjs';
import { publishImmutableFiles, runGh } from './immutable-upload.mjs';
import { assertEvidenceExtension, publishEvidenceRevision, recoverEvidenceSnapshot, verifyEvidenceChain } from './evidence-revision.mjs';

const sourceWorkflows = {
  '.github/workflows/alpha-macos-aarch64.yml': ['darwin-arm64'],
  '.github/workflows/alpha-windows-x64.yml': ['win32-x64', 'win32-arm64'],
  '.github/workflows/release-macos-aarch64.yml': ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64'],
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const targetOf = build => `${build.platform}-${build.arch}`;
const canonicalBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export const candidateArtifactName = (source, target) => `release-candidate-${source.runId}-${source.runAttempt}-${target}`;
function validateSource(source) {
  if (!source || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository) || !/^[1-9]\d*$/.test(source.runId) || !/^[1-9]\d*$/.test(source.runAttempt) || !/^[a-f0-9]{40}$/.test(source.headSha) || !sourceWorkflows[source.workflowPath]) throw new Error('Invalid acceptance source run identity');
}
async function safeFile(dir, name) {
  if (typeof name !== 'string' || basename(name) !== name || /[\\\r\n*?\[]/.test(name)) throw new Error('Unsafe candidate filename');
  const path = join(dir, name);
  if (!(await lstat(path)).isFile()) throw new Error('Candidate requires regular, nonsymlink files');
  return path;
}

/** Called after the last byte-changing build step, before the public gate can fail. */
export async function stageAcceptanceCandidate({ assetsDir, outDir, source }) {
  validateSource(source);
  const names = (await readdir(assetsDir)).filter(name => /^release-evidence-(darwin|win32|linux)-(arm64|x64)\.json$/.test(name));
  if (names.length !== 1) throw new Error('Expected exactly one target evidence in candidate');
  const evidencePath = await safeFile(assetsDir, names[0]);
  const evidenceBytes = await readFile(evidencePath);
  const evidence = JSON.parse(evidenceBytes);
  validateReleaseEvidence(evidence, await evidenceAssetsFromDirectory(evidence, assetsDir));
  const target = targetOf(evidence.build);
  if (!sourceWorkflows[source.workflowPath].includes(target)) throw new Error('Source workflow does not own candidate target');
  const workflowUrl = `https://github.com/${source.repository}/actions/runs/${source.runId}`;
  if (evidence.build.workflowRunUrl !== workflowUrl) throw new Error('Embedded identity belongs to another source run');
  const files = new Set([...evidence.assets.map(asset => asset.name), names[0], 'SHA256SUMS']);
  if (evidence.build.platform === 'darwin') files.add('latest-mac.yml');
  const paths = await Promise.all([...files].map(name => safeFile(assetsDir, name)));
  const records = await observeAssets(paths);
  await mkdir(outDir, { recursive: false, mode: 0o700 });
  for (const path of paths) await cp(path, join(outDir, basename(path)), { force: false, errorOnExist: true });
  const candidate = { schemaVersion: 1, source, target, releaseTag: evidence.releaseTag, build: evidence.build, evidenceName: names[0], evidenceSha256: sha256(evidenceBytes), files: records };
  await writeFile(join(outDir, 'release-candidate.json'), canonicalBytes(candidate), { flag: 'wx' });
  return { candidate, artifactName: candidateArtifactName(source, target) };
}

async function readCandidate(dir, source, target) {
  const bytes = await readFile(await safeFile(dir, 'release-candidate.json'));
  const candidate = JSON.parse(bytes);
  if (candidate.schemaVersion !== 1 || !same(candidate.source, source) || candidate.target !== target || targetOf(candidate.build) !== target || candidate.evidenceName !== evidenceFilename(candidate.build)) throw new Error('Candidate source/build/target identity differs');
  const paths = await Promise.all(candidate.files.map(file => safeFile(dir, file.name)));
  const observed = await observeAssets(paths);
  if (!same(observed, candidate.files) || new Set(candidate.files.map(file => file.name)).size !== candidate.files.length) throw new Error('Candidate final bytes/digest differ');
  const evidenceBytes = await readFile(await safeFile(dir, candidate.evidenceName));
  if (sha256(evidenceBytes) !== candidate.evidenceSha256) throw new Error('Source evidence digest differs');
  const evidence = JSON.parse(evidenceBytes);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(candidate.releaseTag)) throw new Error('Unsafe source release tag identity');
  if (!same(evidence.build, candidate.build) || evidence.releaseTag !== candidate.releaseTag) throw new Error('Candidate build or release tag differs');
  validateReleaseEvidence(evidence, await evidenceAssetsFromDirectory(evidence, dir));
  return { candidate, candidateSha256: sha256(bytes), evidence, dir };
}

/** Produce portable intake only after checking local native captures. No capture paths leave the operator. */
export async function packAcceptance({ candidateDir, receiptPaths }) {
  const metadata = JSON.parse(await readFile(join(candidateDir, 'release-candidate.json'), 'utf8'));
  validateSource(metadata.source);
  const item = await readCandidate(candidateDir, metadata.source, metadata.target);
  let accepted = item.evidence;
  const receipts = [];
  for (const path of receiptPaths) {
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    accepted = importNativeAcceptance(accepted, receipt);
    for (const capture of receipt.native.attachments ?? []) {
      if (sha256(await readFile(capture.path)) !== capture.sha256) throw new Error('Native capture bytes differ before handoff');
    }
    const portable = structuredClone(receipt);
    portable.native.attachments = (portable.native.attachments ?? []).map(({ path: localPath, ...record }) => record);
    receipts.push(portable);
  }
  validateReleaseEvidence(accepted, accepted.assets, { requireTested: true });
  return { schemaVersion: 1, source: metadata.source, targets: [{ target: metadata.target, candidateSha256: item.candidateSha256, sourceEvidenceSha256: metadata.evidenceSha256, receipts }] };
}

export function mergeAcceptanceIntakes(intakes) {
  if (!intakes.length) throw new Error('No native intake supplied');
  const result = { schemaVersion: 1, source: intakes[0].source, targets: [] };
  for (const intake of intakes) {
    if (intake.schemaVersion !== 1 || !same(intake.source, result.source)) throw new Error('Cannot merge foreign source run intake');
    for (const target of intake.targets) {
      if (result.targets.some(item => item.target === target.target)) throw new Error('Duplicate target intake replay');
      result.targets.push(target);
    }
  }
  return result;
}

const notFound = error => error?.status === 404 || /\(HTTP 404\)/.test(String(error?.stderr ?? ''));
async function optionalRelease(repo, tag, gh) {
  try { return JSON.parse(await gh(['release', 'view', tag, '--repo', repo, '--json', 'tagName,isDraft,assets'])); }
  catch (error) { if (!notFound(error)) throw error; return null; }
}
async function verifyReleaseTag(repo, tag, gitSha, gh) {
  let value = JSON.parse(await gh(['api', `repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`]));
  for (let depth = 0; value.object?.type === 'tag' && depth < 4; depth++) value = JSON.parse(await gh(['api', `repos/${repo}/git/tags/${value.object.sha}`]));
  if (value.object?.type !== 'commit' || value.object.sha !== gitSha) throw new Error('Existing release tag points to a foreign source SHA');
}
async function readRemotePayloads(item, repo, gh) {
  const root = await mkdtemp(join(tmpdir(), 'lawoss-resume-readback-'));
  try {
    for (const asset of item.evidence.assets) await gh(['release', 'download', item.evidence.releaseTag, '--repo', repo, '--pattern', asset.name, '--dir', root]);
    const observed = await observeAssets(item.evidence.assets.map(asset => join(root, asset.name)));
    validateReleaseEvidence(item.evidence, observed, { requireTested: true });
    return observed;
  } finally { await rm(root, { recursive: true, force: true }); }
}

/** Resume original artifacts. This command never builds, stamps a version, signs, or changes source identity. */
export async function resumeAcceptance({ repo, sourceRunId, intakePath, outDir, publish = false, validateOnly = false, gh = runGh, promote = promoteAcceptedTargets }) {
  const intakeBytes = await readFile(intakePath);
  const intake = JSON.parse(intakeBytes);
  validateSource(intake.source);
  if (intake.schemaVersion !== 1 || intake.source.repository !== repo || intake.source.runId !== sourceRunId) throw new Error('Foreign source run acceptance intake');
  const source = intake.source;
  const run = JSON.parse(await gh(['api', `repos/${repo}/actions/runs/${sourceRunId}/attempts/${source.runAttempt}`]));
  if (String(run.id) !== sourceRunId || String(run.run_attempt) !== source.runAttempt || run.head_sha !== source.headSha || run.path !== source.workflowPath || run.repository?.full_name !== repo || run.status !== 'completed' || !['workflow_dispatch', 'push'].includes(run.event)) throw new Error('Source run API identity or completed producer differs');
  const supportedTargets = sourceWorkflows[source.workflowPath];
  if (!Array.isArray(intake.targets) || !intake.targets.length || new Set(intake.targets.map(item => item.target)).size !== intake.targets.length || intake.targets.some(item => !supportedTargets.includes(item.target)) || (!validateOnly && intake.targets.length !== supportedTargets.length)) throw new Error('Missing or duplicate native target intake');
  const targets = validateOnly ? intake.targets.map(item => item.target) : supportedTargets;
  const pages = JSON.parse(await gh(['api', `repos/${repo}/actions/runs/${sourceRunId}/artifacts`, '--paginate', '--slurp']));
  const artifacts = pages.flatMap(page => page.artifacts);
  const expectedArtifacts = targets.map(target => candidateArtifactName(source, target));
  for (const name of expectedArtifacts) {
    const matches = artifacts.filter(artifact => artifact.name === name && artifact.expired === false && String(artifact.workflow_run?.id) === sourceRunId && artifact.workflow_run?.head_sha === source.headSha);
    if (matches.length !== 1) throw new Error('Missing, expired or ambiguous original source artifact');
  }
  await mkdir(outDir, { recursive: false, mode: 0o700 });
  const items = [];
  // Complete all local/source/receipt and remote collision checks before any release mutation.
  for (const target of targets) {
    const dir = join(outDir, target);
    await gh(['run', 'download', sourceRunId, '--repo', repo, '--name', candidateArtifactName(source, target), '--dir', dir]);
    const item = await readCandidate(dir, source, target);
    const incoming = intake.targets.find(value => value.target === target);
    if (incoming.candidateSha256 !== item.candidateSha256 || incoming.sourceEvidenceSha256 !== item.candidate.evidenceSha256) throw new Error('Stale candidate/source evidence digest in intake');
    let accepted = item.evidence;
    for (const receipt of incoming.receipts) accepted = importNativeAcceptance(accepted, receipt);
    validateReleaseEvidence(accepted, await evidenceAssetsFromDirectory(accepted, dir), { requireTested: true });
    accepted.acceptanceHandoff = { source, candidateSha256: item.candidateSha256, intakeSha256: sha256(intakeBytes) };
    const existing = await optionalRelease(repo, item.evidence.releaseTag, gh);
    try { await verifyReleaseTag(repo, item.evidence.releaseTag, item.evidence.build.gitSha, gh); }
    catch (error) { if (existing || !notFound(error)) throw error; }
    let canonical;
    if (existing) {
      if (!existing.isDraft && !publish && !validateOnly) throw new Error('Draft resume refuses an existing public release');
      await verifyReleaseTag(repo, item.evidence.releaseTag, item.evidence.build.gitSha, gh);
      const name = item.candidate.evidenceName;
      if (existing.assets.some(asset => asset.name === name)) canonical = await verifyEvidenceChain({ repo, tag: item.evidence.releaseTag, name, gh });
      else canonical = await recoverEvidenceSnapshot({repo,tag:item.evidence.releaseTag,name,gh});
      if (canonical) {
        assertEvidenceExtension(item.evidence, canonical.evidence);
        if (canonical.evidence.acceptanceHandoff) {
          if (!same(canonical.evidence.acceptanceHandoff, accepted.acceptanceHandoff)) throw new Error('Different acceptance handoff replay');
          assertEvidenceExtension(accepted, canonical.evidence);
          accepted = canonical.evidence;
        } else if (canonical.sha256 !== item.candidate.evidenceSha256) throw new Error('Stale original canonical source evidence');
      }
      const scratch = await mkdtemp(join(tmpdir(), 'lawoss-resume-collisions-'));
      try {
        for (const asset of item.evidence.assets.filter(asset => existing.assets.some(remote => remote.name === asset.name))) {
          await gh(['release', 'download', item.evidence.releaseTag, '--repo', repo, '--pattern', asset.name, '--dir', scratch]);
          if (sha256(await readFile(join(scratch, asset.name))) !== asset.sha256) throw new Error('Immutable remote payload collision');
        }
      } finally { await rm(scratch, { recursive: true, force: true }); }
    }
    items.push({ ...item, evidence: accepted, initial: item.evidence, existing, canonical });
  }
  if (validateOnly) return {status:'validated-native-intake',source,targets:items.map(item=>item.candidate.target)};
  for (const item of items) {
    const tag = item.evidence.releaseTag;
    if (!await optionalRelease(repo, tag, gh)) {
      await gh(['release', 'create', tag, '--repo', repo, '--target', item.evidence.build.gitSha, '--draft', '--latest=false', ...(item.evidence.build.channel === 'alpha' ? ['--prerelease'] : []), '--notes', `Candidate from source run ${source.runId}, attempt ${source.runAttempt}. Native acceptance required.`]);
    }
    await verifyReleaseTag(repo, tag, item.evidence.build.gitSha, gh);
    const payloadPaths = item.evidence.assets.map(asset => join(item.dir, asset.name));
    await publishImmutableFiles({ files: payloadPaths, repo, tag, gh });
    if (!item.canonical) {
      // Seed the original producer bytes, then extend through the sole canonical owner.
      await publishEvidenceRevision({ path: join(item.dir, item.candidate.evidenceName), repo, tag, gh });
      item.canonical = { sha256: item.candidate.evidenceSha256 };
    }
    const canonicalPath = join(item.dir, item.candidate.evidenceName);
    if (item.evidence.evidenceHistory) {
      // Already accepted/published retry: keep the exact remote bytes and complete chain.
      await writeFile(canonicalPath, item.canonical.bytes);
    } else await writeFile(canonicalPath, canonicalBytes(item.evidence));
    const revision = await publishEvidenceRevision({ path: canonicalPath, repo, tag, expectedRemoteSha256: item.canonical.sha256, gh });
    item.evidence = revision.evidence;
    item.canonical = revision;
    await writeFile(canonicalPath, revision.bytes);
  }
  if (publish) {
    // Only explicit publish mode crosses the draft/public boundary, after all target intake gates.
    for (const item of items) await verifyReleaseTag(repo, item.evidence.releaseTag, item.evidence.build.gitSha, gh);
    for (const tag of new Set(items.map(item => item.evidence.releaseTag))) {
      const state = await optionalRelease(repo, tag, gh);
      if (state.isDraft) await gh(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest=false']);
    }
    for (const item of items) {
      const tag = item.evidence.releaseTag;
      const release = await optionalRelease(repo, tag, gh);
      const observedAssets = await readRemotePayloads(item, repo, gh);
      const published = recordPublishedEvidence(item.evidence, { release, observedAssets, actor: 'acceptance-resume', at: new Date().toISOString(), evidenceUrl: `https://github.com/${repo}/releases/tag/${tag}` });
      const path = join(item.dir, item.candidate.evidenceName);
      await writeFile(path, canonicalBytes(published));
      const revision = await publishEvidenceRevision({ path, repo, tag, expectedRemoteSha256: item.canonical.sha256, gh });
      item.evidence = revision.evidence;
      item.canonical = revision;
      await writeFile(path, revision.bytes);
    }
    // No feed can be published if even one target's appended metadata or chain is missing.
    for (const item of items) await verifyEvidenceChain({ repo, tag: item.evidence.releaseTag, name: item.candidate.evidenceName, expectedSha256: item.canonical.sha256, gh });
    await promote({ items, repo, outDir, gh });
  }
  return { status: publish ? 'published-and-promoted' : 'accepted-draft', source, targets: items.map(item => ({ build: item.evidence.build, releaseTag: item.evidence.releaseTag, evidenceSha256: item.canonical.sha256 })) };
}

export async function collectAcceptanceIntakes({repo,sourceRunId,intakeRunIds,outDir,gh=runGh}) {
  if(!/^[1-9]\d*$/.test(sourceRunId)||!Array.isArray(intakeRunIds)||!intakeRunIds.length||intakeRunIds.some(id=>!/^[1-9]\d*$/.test(id))||new Set(intakeRunIds).size!==intakeRunIds.length)throw new Error('Invalid or replayed intake run IDs');
  await mkdir(outDir,{recursive:false,mode:0o700});
  const intakes=[];
  for(const id of intakeRunIds){
    const run=JSON.parse(await gh(['api',`repos/${repo}/actions/runs/${id}`]));
    if(String(run.id)!==id||run.repository?.full_name!==repo||run.path!=='.github/workflows/release-acceptance-resume.yml'||run.event!=='workflow_dispatch'||run.status!=='completed'||run.conclusion!=='success')throw new Error('Foreign, unfinished or unsuccessful native intake run');
    const name=`release-native-intake-${sourceRunId}-${id}`;
    const pages=JSON.parse(await gh(['api',`repos/${repo}/actions/runs/${id}/artifacts`,'--paginate','--slurp']));
    const artifacts=pages.flatMap(page=>page.artifacts).filter(asset=>asset.name===name&&asset.expired===false&&String(asset.workflow_run?.id)===id&&asset.workflow_run?.head_sha===run.head_sha);
    if(artifacts.length!==1)throw new Error('Missing or ambiguous native intake artifact');
    const dir=join(outDir,id);await gh(['run','download',id,'--repo',repo,'--name',name,'--dir',dir]);
    const intake=JSON.parse(await readFile(await safeFile(dir,'intake.json'),'utf8'));
    if(intake.source?.runId!==sourceRunId||intake.source?.repository!==repo)throw new Error('Native intake artifact belongs to another source');
    intakes.push(intake);
  }
  const result=mergeAcceptanceIntakes(intakes);await writeFile(join(outDir,'intake.json'),canonicalBytes(result),{flag:'wx'});return result;
}

async function promoteAcceptedTargets({ items, repo, outDir, gh }) {
  if (items[0].evidence.build.channel === 'stable') {
    // This existing single shared-manifest publisher re-verifies all final payload and evidence bytes.
    execFileSync(process.execPath, [fileURLToPath(new URL('./publish-electron-assets.mjs', import.meta.url)), '--manifests-only', outDir, items[0].evidence.releaseTag], { stdio: 'inherit', env: { ...process.env, RELEASE_REPOSITORY: repo } });
  } else {
    const { promoteAlphaTarget } = await import('./acceptance-promotion.mjs');
    for (const item of items) await promoteAlphaTarget({ item, repo, gh });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  const arg = name => { const i = args.indexOf(`--${name}`); if (i < 0 || !args[i + 1]) throw new Error(`Missing --${name}`); return args[i + 1]; };
  const all = name => args.flatMap((value, index) => value === `--${name}` ? [args[index + 1]] : []);
  if (command === 'stage') {
    const workflow = process.env.GITHUB_WORKFLOW_REF?.split('@')[0].split('/').slice(2).join('/');
    console.log(JSON.stringify(await stageAcceptanceCandidate({ assetsDir: resolve(arg('assets-dir')), outDir: resolve(arg('out')), source: { repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, headSha: process.env.GITHUB_SHA, workflowPath: workflow } })));
  } else if (command === 'pack') {
    const intake = await packAcceptance({ candidateDir: resolve(arg('candidate-dir')), receiptPaths: all('receipt') });
    await writeFile(arg('out'), canonicalBytes(intake), { flag: 'wx' });
  } else if (command === 'merge') {
    const intakes = await Promise.all(all('intake').map(async path => JSON.parse(await readFile(path, 'utf8'))));
    await writeFile(arg('out'), canonicalBytes(mergeAcceptanceIntakes(intakes)), { flag: 'wx' });
  } else if (command === 'collect') {
    await collectAcceptanceIntakes({repo:process.env.RELEASE_REPOSITORY||process.env.GITHUB_REPOSITORY,sourceRunId:arg('source-run-id'),intakeRunIds:arg('intake-run-ids').split(',').map(id=>id.trim()),outDir:resolve(arg('out'))});
  } else if (command === 'resume' || command === 'validate') {
    console.log(JSON.stringify(await resumeAcceptance({ repo: process.env.RELEASE_REPOSITORY || process.env.GITHUB_REPOSITORY, sourceRunId: arg('source-run-id'), intakePath: arg('intake'), outDir: resolve(arg('out')), publish: args.includes('--publish'),validateOnly:command==='validate' })));
  } else throw new Error('Usage: acceptance-handoff.mjs stage|pack|merge|resume');
}
