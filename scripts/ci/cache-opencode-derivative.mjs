// Development-only build reuse. Production signing always starts from source.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareOpencodeEngine, sourceBuildIdentity } from '../../packages/opencode-release/build/prepare.mjs';
import recipe from '../../packages/opencode-release/build/recipe.json' with { type: 'json' };

export function developmentCacheKey(identity, helpers) {
  assert.equal(identity.mode, 'development', 'Production engines cannot use a development cache');
  assert.match(identity.sourceKey, /^[a-f0-9]{64}$/);
  // Preparation still fingerprints the current verifier, but it does not change
  // compiled OpenCode bytes. Always run that verifier again after restoring.
  const { sourceKey, files, ...build } = identity;
  build.files = Object.fromEntries(Object.entries(files).filter(([name]) => name !== 'derivative.mjs'));
  const digest = createHash('sha256').update(JSON.stringify({ identity: build, helpers })).digest('hex');
  return `opencode-development-v2-${digest}`;
}

export async function reusableBaseProducer({ identity, helpers, baseSha, baseRef, readFileAt, artifacts, limit = 5 }) {
  assert.equal(identity.mode, 'development', 'Production engines cannot reuse a base artifact');
  const inputs = { ...Object.fromEntries(Object.entries(identity.files)
    .filter(([name]) => name !== 'derivative.mjs').map(([name, hash]) => [`packages/opencode-release/${name}`, hash])),
    ...Object.fromEntries(Object.entries(helpers).map(([name, hash]) => [`scripts/ci/${name}`, hash])) };
  const unchanged = async sha => {
    for (const [name, hash] of Object.entries(inputs)) {
      // 🟡 LAWOSS: a commit without this input (dev before engine v2) cannot seed the cache.
      let bytes;
      try { bytes = await readFileAt(sha, name); } catch { return false; }
      if (createHash('sha256').update(bytes).digest('hex') !== hash) return false;
    }
    return true;
  };
  // Only same-repository runs of the trusted base branch can seed a new/evicted cache.
  // Another PR's cache or artifact cannot supply this fallback.
  const trusted = artifacts.filter(artifact => !artifact.expired && artifact.name === 'opencode-derivative-ci'
    && artifact.workflow_run?.head_branch === baseRef && typeof artifact.workflow_run.head_sha === 'string'
    && Number.isSafeInteger(artifact.workflow_run.repository_id)
    && artifact.workflow_run.head_repository_id === artifact.workflow_run.repository_id)
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  // 🟡 LAWOSS: prefer the PR's exact base commit, then the newest base-branch run whose engine
  // inputs are byte-identical (e.g. the dev warm-cache build). Manual dev releases have no PR base.
  const exact = trusted.filter(artifact => baseSha && artifact.workflow_run.head_sha === baseSha);
  const candidates = [...exact, ...trusted.filter(artifact => !exact.includes(artifact))].slice(0, limit);
  for (const artifact of candidates) if (await unchanged(artifact.workflow_run.head_sha)) return artifact.workflow_run.id;
  return undefined;
}

export async function verifyCachedEngine(directory) {
  const receiptPath = path.join(directory, 'distribution-receipt.json');
  assert.ok((await lstat(receiptPath)).isFile(), 'Build receipt must be an ordinary file');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.match(receipt.manifestSha256, /^[a-f0-9]{64}$/);
  const outputDirectory = await realpath(await mkdtemp(path.join(tmpdir(), 'opencode-cache-check-')));
  try {
    // The existing preparation verifier checks every archive, provenance record,
    // current patch/recipe/compiler pin, and complete target coverage. Cached
    // receipts never nominate source policy or publish a production selector.
    return await prepareOpencodeEngine({ mode: 'development', targets: recipe.targets,
      outputDirectory, distributionDirectory: directory, manifestSha256: receipt.manifestSha256 });
  } finally { await rm(outputDirectory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let output;
  if (['key', 'base-producer'].includes(process.argv[2])) {
    // 🟡 LAWOSS: kľúč vždy pre pinovaný builder (darwin-arm64), aby ho rovnako spočítal aj ubuntu
    // job, ktorý pred kompiláciou zisťuje, či engine už je v cache a macOS runner netreba.
    const builder = 'darwin-arm64';
    const identity = { ...await sourceBuildIdentity({ mode: 'development', targets: recipe.targets }),
      host: builder, compiler: recipe.toolchain.executables[builder] };
    const helpers = {};
    for (const name of ['build-opencode-derivative.mjs']) {
      helpers[name] = createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex');
    }
    if (process.argv[2] === 'key') output = `key=${developmentCacheKey(identity, helpers)}\n`;
    else {
      const { BASE_SHA: baseSha = '', GITHUB_REPOSITORY: repository, GH_TOKEN: token } = process.env;
      // 🟡 LAWOSS: a manual or push run on dev reuses a dev producer with identical engine inputs.
      const baseRef = process.env.BASE_REF || (process.env.GITHUB_REF_NAME === 'dev' ? 'dev' : '');
      let producer;
      if (baseRef) {
        if (baseSha) assert.match(baseSha, /^[a-f0-9]{40}$/);
        assert.match(repository, /^[\w.-]+\/[\w.-]+$/);
        const readFileAt = (sha, name) => {
          assert.match(sha, /^[a-f0-9]{40}$/);
          try { execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'pipe' }); }
          catch { execFileSync('git', ['fetch', '--depth=1', 'origin', sha], { stdio: 'pipe' }); }
          return execFileSync('git', ['show', `${sha}:${name}`], { stdio: ['ignore', 'pipe', 'pipe'] });
        };
        const response = await fetch(`https://api.github.com/repos/${repository}/actions/artifacts?name=opencode-derivative-ci&per_page=100`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
        if (!response.ok) throw new Error(`Cannot look up the base engine producer (${response.status}).`);
        producer = await reusableBaseProducer({ identity, helpers, baseSha, baseRef, readFileAt, artifacts: (await response.json()).artifacts });
      }
      output = `run-id=${producer ?? ''}\n`;
    }
  } else if (process.argv[2] === 'verify' && process.argv[3]) {
    const result = await verifyCachedEngine(path.resolve(process.argv[3]));
    output = `manifest-sha256=${result.manifestSha256}\n`;
  } else throw new Error('Use key, base-producer or verify <development-distribution-directory>');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output);
  console.log(output);
}
