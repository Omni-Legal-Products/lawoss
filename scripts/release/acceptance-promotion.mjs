import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateChannelPromotion } from './channel-evidence.mjs';
import { observeAssets, sha256, createPromotionReceipt } from './release-evidence.mjs';
import { verifyEvidenceChain } from './evidence-revision.mjs';
import { publishImmutableFiles } from './immutable-upload.mjs';
const notFound = error => error?.status === 404 || /\(HTTP 404\)/.test(String(error?.stderr ?? ''));
const scalar = value => value.trim().replace(/^(['"])(.*)\1$/, '$2');

/** Only the serialized acceptance-resume job writes the fixed platform/arch feed. */
export async function promoteAlphaTarget({ item, repo, gh }) {
  const evidence = item.evidence;
  const build = evidence.build;
  const pointerTag = build.platform === 'darwin' ? 'alpha-macos-latest' : 'alpha-windows-latest';
  const manifestName = build.platform === 'darwin' ? 'latest-mac.yml' : build.arch === 'arm64' ? 'latest-arm64.yml' : 'latest.yml';
  const sourceManifest = build.platform === 'darwin' ? `latest-mac-${build.arch}.yml` : manifestName;
  if (!evidence.assets.some(asset => asset.name === sourceManifest)) throw new Error('Target updater manifest missing from final evidence');
  const root = await mkdtemp(join(tmpdir(), 'lawoss-alpha-promotion-'));
  try {
    const release = JSON.parse(await gh(['release', 'view', evidence.releaseTag, '--repo', repo, '--json', 'tagName,isDraft']));
    for (const asset of evidence.assets) await gh(['release', 'download', evidence.releaseTag, '--repo', repo, '--pattern', asset.name, '--dir', root]);
    const observedAssets = await observeAssets(evidence.assets.map(asset => join(root, asset.name)));
    const manifest = await readFile(join(root, sourceManifest), 'utf8');
    const files = [];
    let current;
    for (const line of manifest.split(/\r?\n/)) {
      const url = line.match(/^\s*-\s+url:\s*(.+)$/);
      if (url) { current = { name: scalar(url[1]) }; files.push(current); }
      else if (current && /^\s+sha512:/.test(line)) current.sha512 = scalar(line.replace(/^\s+sha512:\s*/, ''));
    }
    if (!files.length || scalar(manifest.match(/^version:\s*(.+)$/m)?.[1] ?? '') !== build.version) throw new Error('Target updater version/files differ');
    for (const file of files) {
      if (!evidence.assets.some(asset => asset.name === file.name)) throw new Error('Updater references an unowned target');
      if (createHash('sha512').update(await readFile(join(root, file.name))).digest('base64') !== file.sha512) throw new Error('Updater digest differs from final uploaded bytes');
    }
    const baseUrl = `https://github.com/${repo}/releases/download/${encodeURIComponent(evidence.releaseTag)}`;
    const desired = manifest.replace(/((?:url|path):\s*)(['"]?)(lawoss-[^'"\r\n]+)\2/g, (_, prefix, quote, name) => `${prefix}${quote}${baseUrl}/${name}${quote}`);
    let pointer;
    try { pointer = JSON.parse(await gh(['release', 'view', pointerTag, '--repo', repo, '--json', 'tagName,isDraft,assets'])); }
    catch (error) { if (!notFound(error)) throw error; }
    let previous;
    if (pointer?.assets.some(asset => asset.name === manifestName)) {
      const pointerDir = join(root, 'previous');
      await import('node:fs/promises').then(fs => fs.mkdir(pointerDir));
      await gh(['release', 'download', pointerTag, '--repo', repo, '--pattern', manifestName, '--dir', pointerDir]);
      previous = await readFile(join(pointerDir, manifestName), 'utf8');
    }
    await verifyEvidenceChain({ repo, tag: evidence.releaseTag, name: item.candidate.evidenceName, expectedSha256: item.canonical.sha256, gh });
    if (previous === desired) return; // Exact fully verified replay, not an equal-version replacement.
    const currentVersion = previous ? scalar(previous.match(/^version:\s*(.+)$/m)?.[1] ?? '') : undefined;
    if (previous && !currentVersion) throw new Error('Current pointer version unavailable');
    validateChannelPromotion({ evidence, release, observedAssets, pointerTag, manifestName, currentVersion });
    const receipt = createPromotionReceipt({ manifest: { name: manifestName, sha256: sha256(desired), references: files.map(file => file.name) }, evidences: [{ evidence, sha256: item.canonical.sha256 }] });
    const receiptPath = join(root, `promotion-${build.platform}-${build.arch}-${sha256(JSON.stringify(receipt))}.json`);
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    await publishImmutableFiles({ files: [receiptPath], repo, tag: evidence.releaseTag, gh });
    if (!pointer) await gh(['release', 'create', pointerTag, '--repo', repo, '--target', build.gitSha, '--prerelease', '--latest=false', '--notes', 'Platform updater pointer. Immutable source releases retain provenance.']);
    const output = join(root, manifestName);
    await writeFile(output, desired);
    // The only clobber exception is the existing, explicitly named mutable updater feed.
    await gh(['release', 'upload', pointerTag, output, '--repo', repo, ...(previous ? ['--clobber'] : [])]);
    const readback = join(root, 'readback');
    await import('node:fs/promises').then(fs => fs.mkdir(readback));
    await gh(['release', 'download', pointerTag, '--repo', repo, '--pattern', manifestName, '--dir', readback]);
    if (sha256(await readFile(join(readback, manifestName))) !== sha256(desired)) throw new Error('Updater pointer readback differs');
  } finally { await rm(root, { recursive: true, force: true }); }
}
