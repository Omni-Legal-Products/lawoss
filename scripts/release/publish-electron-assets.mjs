#!/usr/bin/env node
import { publishEvidenceRevision, verifyEvidenceChain } from './evidence-revision.mjs';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { publishImmutableFiles, runGh } from './immutable-upload.mjs';
import { createPromotionReceipt, evidenceFilename, observeAssets, sha256, validateReleaseEvidence } from './release-evidence.mjs';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createChecksums, isElectronReleaseAsset, mergeChecksums } from "./checksums.mjs";

const args = process.argv.slice(2);
const manifestsOnly = args.includes("--manifests-only");
const payloadOnly = args.includes("--payload-only");
const draftPayload = args.includes("--draft-payload");
const positional = args.filter((arg) => !["--manifests-only", "--payload-only", "--draft-payload"].includes(arg));
const [distRootArg, releaseTag] = positional;

if (!distRootArg || !releaseTag) {
  console.error("Usage: node scripts/release/publish-electron-assets.mjs [--manifests-only] <dist-root> <release-tag>");
  process.exit(2);
}

// RELEASE_REPOSITORY lets the release workflow publish outside the source repository.
const repo = process.env.RELEASE_REPOSITORY || process.env.GITHUB_REPOSITORY;
if (!repo) {
  console.error("RELEASE_REPOSITORY or GITHUB_REPOSITORY is required.");
  process.exit(2);
}

const distRoot = resolve(distRootArg);
const outputDir = resolve(process.env.RUNNER_TEMP || ".", "legalwork-electron-manifests");
mkdirSync(outputDir, { recursive: true });

function walk(dir) {
  const entries = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) entries.push(...walk(path));
    else if (stat.isFile()) entries.push(path);
  }
  return entries;
}

function isUpdaterManifest(path) {
  return /^latest.*\.ya?ml$/.test(basename(path));
}

function isReleaseAsset(path) {
  return isElectronReleaseAsset(path);
}


function parseManifest(path) {
  const raw = readFileSync(path, "utf8");
  const parsed = { files: [] };
  let currentFile = null;

  for (const line of raw.split(/\r?\n/)) {
    const topLevel = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (topLevel) {
      const [, key, value] = topLevel;
      if (key !== "files") parsed[key] = unquoteYamlScalar(value);
      currentFile = null;
      continue;
    }

    const fileStart = line.match(/^\s*-\s+([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (fileStart) {
      const [, key, value] = fileStart;
      currentFile = {};
      currentFile[key] = parseYamlScalar(value);
      parsed.files.push(currentFile);
      continue;
    }

    const fileProp = line.match(/^\s{4}([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (fileProp && currentFile) {
      const [, key, value] = fileProp;
      currentFile[key] = parseYamlScalar(value);
    }
  }

  if (!parsed.version) throw new Error(`Missing version in ${path}`);
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error(`Missing files in ${path}`);
  }
  return parsed;
}

function unquoteYamlScalar(value) {
  const trimmed = String(value || "").trim();
  return trimmed.replace(/^['"]|['"]$/g, "");
}

function parseYamlScalar(value) {
  const unquoted = unquoteYamlScalar(value);
  if (/^\d+$/.test(unquoted)) return Number(unquoted);
  return unquoted;
}

function quoteYamlScalar(value) {
  const string = String(value ?? "");
  if (!string || /[:#\[\]{}&,*!|>'"%@`\s]/.test(string)) {
    return `'${string.replace(/'/g, "''")}'`;
  }
  return string;
}

function stringifyManifest(manifest) {
  const lines = [`version: ${quoteYamlScalar(manifest.version)}`, "files:"];
  for (const file of manifest.files) {
    lines.push(`  - url: ${quoteYamlScalar(file.url)}`);
    for (const [key, value] of Object.entries(file)) {
      if (key === "url") continue;
      lines.push(`    ${key}: ${typeof value === "number" ? value : quoteYamlScalar(value)}`);
    }
  }
  if (manifest.releaseDate) lines.push(`releaseDate: ${quoteYamlScalar(manifest.releaseDate)}`);
  return `${lines.join("\n")}\n`;
}

function sortFiles(files) {
  const rank = (url) => {
    const value = String(url || "");
    if (value.includes("arm64")) return 0;
    if (value.includes("x64") || value.includes("x86_64")) return 1;
    return 2;
  };
  return [...files].sort((left, right) => {
    const byRank = rank(left.url) - rank(right.url);
    if (byRank !== 0) return byRank;
    const leftExt = extname(String(left.url || ""));
    const rightExt = extname(String(right.url || ""));
    if (leftExt === ".zip" && rightExt !== ".zip") return -1;
    if (rightExt === ".zip" && leftExt !== ".zip") return 1;
    return String(left.url || "").localeCompare(String(right.url || ""));
  });
}

function mergeManifests(name, paths) {
  const manifests = paths.map(parseManifest);
  const version = manifests[0].version;
  for (const manifest of manifests) {
    if (manifest.version !== version) {
      throw new Error(`${name} has mixed versions: ${version} and ${manifest.version}`);
    }
  }

  const filesByUrl = new Map();
  for (const manifest of manifests) {
    for (const file of manifest.files) {
      if (!file?.url) throw new Error(`${name} contains a file entry without url.`);
      filesByUrl.set(file.url, file);
    }
  }

  const releaseDates = manifests.map((manifest) => manifest.releaseDate).filter(Boolean).sort();
  const merged = {
    version,
    files: sortFiles([...filesByUrl.values()]),
  };
  if (releaseDates.length) merged.releaseDate = releaseDates[releaseDates.length - 1];
  return merged;
}

function validateManifest(name, manifest) {
  const urls = manifest.files.map((file) => String(file.url || ""));
  if (name === "latest-mac.yml") {
    for (const arch of ["mac-arm64", "mac-x64"]) {
      if (!urls.some((url) => url.includes(arch))) {
        throw new Error(`${name} is missing ${arch} artifacts.`);
      }
    }
  }
  if (name === "latest-linux.yml" && urls.some((url) => url.includes("arm64"))) {
    throw new Error(`${name} should remain the Linux x64 feed; arm64 belongs in latest-linux-arm64.yml.`);
  }
  if (name === "latest-linux-arm64.yml" && !urls.some((url) => url.includes("arm64"))) {
    throw new Error(`${name} is missing Linux arm64 artifacts.`);
  }
  // NSIS does not filter the files array by CPU architecture. Mixing both
  // installers here silently sends the first .exe to every Windows client.
  if (name === "latest.yml" || name === "latest-arm64.yml") {
    const arch = name === "latest-arm64.yml" ? "arm64" : "x64";
    if (!urls.every((url) => url.includes(`win-${arch}-`) && url.endsWith(".exe"))) {
      throw new Error(`${name} must contain only Windows ${arch} installers.`);
    }
  }
}

const files = walk(distRoot);
const evidencePaths=files.filter(path=>/^release-evidence-(darwin|win32|linux)-(arm64|x64)\.json$/.test(basename(path)));
if(!evidencePaths.length)throw new Error('Missing per-target release evidence');
const evidenceItems=evidencePaths.map(path=>({path,evidence:JSON.parse(readFileSync(path,'utf8'))}));
for(const {path,evidence}of evidenceItems){
 if(basename(path)!==evidenceFilename(evidence.build)||evidence.releaseTag!==releaseTag)throw new Error('Evidence target filename or exact release tag differs');
 validateReleaseEvidence(evidence,evidence.assets,{requireTested:!draftPayload});
}
const evidenceNames=new Set(evidenceItems.flatMap(x=>x.evidence.assets.map(asset=>asset.name)));
for(const path of files.filter(isReleaseAsset))if(!evidenceNames.has(basename(path)))throw new Error(`Unowned release payload: ${basename(path)}`);
if(payloadOnly){
 for(const {path,evidence}of evidenceItems)validateReleaseEvidence(evidence,await observeAssets(evidence.assets.map(asset=>join(dirname(path),asset.name))),{requireTested:!draftPayload});
 await publishImmutableFiles({files:[...files.filter(isReleaseAsset),...evidencePaths,...files.filter(isUpdaterManifest).filter(path=>evidenceNames.has(basename(path)))],tag:releaseTag,repo,requireDraft:draftPayload});
 process.exit(0);
}
const releaseAssets = files.filter(isReleaseAsset);
const manifestsByName = new Map();
// Matrix jobs hash the final signed installers before uploading them. Their
// lists travel with the manifests so this job never needs to download binaries.
const checksums = manifestsOnly
  ? await mergeChecksums(files.filter((path) => basename(path) === "SHA256SUMS"))
  : await createChecksums(releaseAssets);

for (const path of files.filter(isUpdaterManifest).filter(path=>!/^latest-mac-(arm64|x64)\.yml$/.test(basename(path)))) {
  if (manifestsOnly && !files.includes(join(dirname(path), "SHA256SUMS"))) {
    throw new Error(`Missing SHA256SUMS alongside ${path}`);
  }
  const name = basename(path);
  const current = manifestsByName.get(name) || [];
  current.push(path);
  manifestsByName.set(name, current);
}

if (!manifestsOnly && releaseAssets.length === 0) {
  console.error(`No Electron release assets found under ${distRoot}`);
  process.exit(1);
}

if (manifestsByName.size === 0) {
  console.error(`No Electron updater manifests found under ${distRoot}`);
  process.exit(1);
}

// Validate the complete publication before replacing any release assets.
const checksumNames = new Set(checksums.trimEnd().split("\n").map((line) => line.slice(66)));
const mergedManifests = [...manifestsByName.entries()].sort().map(([name, paths]) => {
  const manifest = mergeManifests(name, paths);
  validateManifest(name, manifest);
  for (const file of manifest.files) {
    if (!checksumNames.has(file.url)) {
      throw new Error(`Missing SHA256SUMS entry for ${file.url} referenced by ${name}`);
    }
  }
  return [name, manifest];
});

// Read the exact immutable payload back before producing any common updater feed.
const verificationRoot=await mkdtemp(join(tmpdir(),'lawoss-promotion-'));
try {
 for(const {path,evidence}of evidenceItems){
  const targetRoot=join(verificationRoot,`${evidence.build.platform}-${evidence.build.arch}`);mkdirSync(targetRoot,{recursive:true});
  for(const asset of evidence.assets){
   if(manifestsOnly)await runGh(['release','download',releaseTag,'--repo',repo,'--pattern',asset.name,'--dir',targetRoot]);
   else writeFileSync(join(targetRoot,asset.name),readFileSync(join(dirname(path),asset.name)));
  }
  validateReleaseEvidence(evidence,await observeAssets(evidence.assets.map(asset=>join(targetRoot,asset.name))),{requireTested:true});
 }
 const outputs=[];
 for(const [name,manifest] of mergedManifests){
  for(const file of manifest.files){
   const item=evidenceItems.find(x=>x.evidence.assets.some(asset=>asset.name===file.url));
   if(!item)throw new Error(`Missing validated target for ${file.url}`);
   const bytes=await readFile(join(verificationRoot,`${item.evidence.build.platform}-${item.evidence.build.arch}`,file.url));
   if(file.sha512!==createHash('sha512').update(bytes).digest('base64'))throw new Error(`Updater SHA-512 differs from final bytes: ${file.url}`);
  }
  const outputPath=join(outputDir,name);const bytes=stringifyManifest(manifest);writeFileSync(outputPath,bytes,'utf8');outputs.push(outputPath);
  const receipt=createPromotionReceipt({manifest:{name,sha256:sha256(bytes),references:manifest.files.map(file=>file.url)},evidences:evidenceItems.map(item=>({evidence:item.evidence,sha256:sha256(readFileSync(item.path))}))});
  const receiptPath=join(outputDir,`promotion-${name}-${sha256(JSON.stringify(receipt))}.json`);writeFileSync(receiptPath,`${JSON.stringify(receipt,null,2)}\n`);outputs.push(receiptPath);
 }
 const checksumPath=join(outputDir,'SHA256SUMS');writeFileSync(checksumPath,checksums,'utf8');outputs.push(checksumPath);
 // Canonical evidence is metadata owned by its dedicated writer. A caller here
 // may create initial identical metadata, never silently rebase a remote revision.
 for(const {path,evidence} of evidenceItems){
  const revision=await publishEvidenceRevision({path,repo,tag:releaseTag});
  await verifyEvidenceChain({repo,tag:releaseTag,name:evidenceFilename(evidence.build),expectedSha256:revision.sha256});
 }
 await publishImmutableFiles({files:[...(!manifestsOnly?releaseAssets:[]),...outputs],tag:releaseTag,repo});
}finally{await rm(verificationRoot,{recursive:true,force:true});}
