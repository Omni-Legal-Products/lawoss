#!/usr/bin/env node
// CI-only startup projection. Private alpha receipts remain outside the upload root.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateBuildInfo } from '../../../apps/desktop/electron/build-info.mjs';
import { prepareAcceptanceProfile, ownedProfile } from '../../../apps/desktop/scripts/release-acceptance.mjs';
import { validateLiveIdentity } from '../../../apps/desktop/scripts/release-acceptance-macos.mjs';
import { ALPHA_SCENARIOS } from './coverage.mjs';
import { withExtractedAlphaArtifact, verifyAlphaInstallation } from './installed-artifact.mjs';
import { assertInteractiveUi, launchAlphaApp, nativeAppLayout } from './native-app.mjs';
import { runAlphaAcceptance } from './run.mjs';

const fail = () => { throw new Error('native-startup-unverified'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const equalBuild = (a,b) => Object.keys(b).every(key => a[key] === b[key]) && Object.keys(a).length === Object.keys(b).length;
const inside = (root,target) => { const rel=relative(root,target); return rel!=='' && !isAbsolute(rel) && rel!=='..' && !rel.startsWith(`..${sep}`); };
const captureMethods = {darwin:'macos-owned-window-screencapture',linux:'x11-owned-window-xwd',win32:'windows-owned-window-printwindow'};
async function hashFile(file) {
  if (!(await lstat(file)).isFile()) fail();
  const hash=createHash('sha256'); for await(const bytes of createReadStream(file))hash.update(bytes); return hash.digest('hex');
}
async function physicalDirectory(directory) {
  const path=resolve(directory),info=await lstat(path);
  if(!info.isDirectory() || info.isSymbolicLink() || await realpath(path)!==path)fail();
  return path;
}
async function boundedFile(file,maximum) {
  const info=await lstat(file); if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1 || info.size>maximum)fail();
  const handle=await open(file,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened=await handle.stat(); if(opened.dev!==info.dev || opened.ino!==info.ino || opened.size>maximum)fail();
    const bytes=await handle.readFile(); if(bytes.length>maximum)fail(); return bytes;
  } finally {await handle.close();}
}
function welcome(observed) {
  if(observed?.snapshot?.route!=='/welcome')fail(); assertInteractiveUi(observed.snapshot);
}
function installationProjection(installation,platform,expectedSha256) {
  const methods=platform==='darwin'?['sha256-zip-installed-tree','sha256-dmg-installed-tree']:platform==='linux'?['sha256-appimage-installed-tree','sha256-tar-installed-tree']:['sha256-nsis-installed-tree'];
  if(installation?.status!=='verified' || installation.signing!=='not-asserted' || installation.assetSha256!==expectedSha256 || !methods.includes(installation.method))fail();
  return {status:'verified',method:installation.method,signing:'not-asserted',assetSha256:expectedSha256};
}
export function startupAssetName(platform,arch,version) {
  if(!['x64','arm64'].includes(arch) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))fail();
  if(platform==='darwin')return `lawoss-mac-${arch}-${version}.zip`;
  if(platform==='linux')return `lawoss-linux-${arch==='x64'?'x86_64':arch}-${version}.AppImage`;
  if(platform==='win32')return `lawoss-win-${arch}-${version}.exe`;
  fail();
}

/** Explicit build identity permits local diagnostics of an older, honestly identified artifact.
 * The CLI below always pins the current checkout. Adapters are constructor-only test boundaries. */
export async function runNativeStartupProbe(options,adapters={}) {
  const {asset,expectedSha256,installedApp}=options;
  const build=validateBuildInfo(options.expectedBuild);
  if(build.platform!==process.platform || build.arch!==process.arch || !/^[a-f0-9]{64}$/.test(expectedSha256??''))fail();
  if(await hashFile(asset)!==expectedSha256)fail();
  const temporaryRoot=await physicalDirectory(options.temporaryRoot);
  const parent=await physicalDirectory(dirname(resolve(options.outputDir))),outputDir=join(parent,basename(options.outputDir));
  await mkdir(outputDir,{mode:0o700}); // exclusive: an existing directory or symlink is always refused
  const privateRoot=await realpath(await mkdtemp(join(temporaryRoot,'lawoss-ci-startup-private-')));
  if(inside(outputDir,privateRoot) || inside(privateRoot,outputDir) || outputDir===privateRoot)fail();
  const profileRoot=join(privateRoot,'profile'),receiptFile=join(privateRoot,'fresh-receipt.json');
  await prepareAcceptanceProfile({root:profileRoot,kind:'fresh'});
  const profile=await ownedProfile(profileRoot,'fresh');
  const withArtifact=adapters.withArtifact ?? (process.platform==='win32'
    ? async (artifact,use)=>{if(!installedApp)fail();const installation=await verifyAlphaInstallation({...artifact,installedApp});return use({installedApp,installation,retain:()=>{}});}
    : withExtractedAlphaArtifact);
  const result=await withArtifact({platform:build.platform,arch:build.arch,asset,expectedSha256},async loan=>{
    const installation=installationProjection(loan.installation,build.platform,expectedSha256);
    const layout=nativeAppLayout(loan.installedApp);
    const embedded=validateBuildInfo(JSON.parse(await boundedFile(join(layout.resources,'build-info.json'),16384)));
    if(!equalBuild(embedded,build))fail();
    const expected={build,userData:join(profile.root,'userdata'),executable:await realpath(layout.executable),rendererRoot:await realpath(layout.rendererRoot)};
    let receipt, launchedPid;
    try {
      receipt=await (adapters.runAcceptance ?? runAlphaAcceptance)({installedApp:loan.installedApp,asset,expectedSha256,build,profileRoot:profile.root,profileKind:'fresh',output:receiptFile,manual:false},{
        verifyInstallation:async()=>installation,
        launch:async options=>{
          const app=await (adapters.launch ?? launchAlphaApp)(options);
          launchedPid=app.pid;
          return {...app,capture:async path=>{
            const before=await app.observe();welcome(before);validateLiveIdentity(before,{...expected,pid:app.pid});
            const capture=await app.capture(path);
            const after=await app.observe();welcome(after);validateLiveIdentity(after,{...expected,pid:app.pid});
            return capture;
          }};
        },
      });
    } catch(error) {
      // An exception before a final receipt cannot prove closure. Preserve executable and lease.
      loan.retain();throw error;
    }
    if(receipt.cleanup!=='verified'){loan.retain();fail();}
    if(receipt.kind!=='lawoss-private-alpha' || receipt.releaseEligible!==false || receipt.status!=='blocked'
      || receipt.profile!=='fresh' || receipt.profileRoot!==profile.root || receipt.profileOwner!==profile.owner
      || !equalBuild(receipt.build,build) || receipt.assetSha256!==expectedSha256 || !Array.isArray(receipt.reasons) || receipt.reasons.length
      || !Array.isArray(receipt.scenarios) || receipt.scenarios.length!==ALPHA_SCENARIOS.length)fail();
    if(JSON.stringify(installationProjection(receipt.installation,build.platform,expectedSha256))!==JSON.stringify(installation))fail();
    for(const [index,scenario] of ALPHA_SCENARIOS.entries()) {
      const recorded=receipt.scenarios[index];
      if(recorded.scenario!==scenario || recorded.status!==(index===0?'pass':'blocked') || recorded.evidence!==join(`${receiptFile}.evidence`,`${scenario}.json`))fail();
    }
    const evidence=JSON.parse(await boundedFile(receipt.scenarios[0].evidence,256*1024));
    if(evidence.scenario!=='startup' || evidence.status!=='pass' || evidence.operator!==null || evidence.profile?.root!==profile.root || evidence.profile.owner!==profile.owner || evidence.profile.kind!=='fresh')fail();
    welcome(evidence.observed);
    const format=build.platform==='linux'?'xwd':'png',file=`startup.${format}`,capture=evidence.capture;
    if(!capture || capture.ownerPid!==launchedPid || !Number.isSafeInteger(capture.ownerPid) || capture.ownerPid<1 || capture.path!==join(`${receiptFile}.evidence`,file) || capture.format!==format || capture.method!==captureMethods[build.platform])fail();
    validateLiveIdentity(evidence.observed,{...expected,pid:capture.ownerPid});
    const bytes=await boundedFile(capture.path,64*1024**2);
    if(digest(bytes)!==capture.sha256 || (format==='png' ? bytes.length<24 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes.length<100 || bytes.readUInt32BE(4)!==7))fail();
    return {bytes,receipt:{schemaVersion:1,kind:'lawoss-ci-native-startup',status:'verified',releaseEligible:false,build,assetSha256:expectedSha256,installation,
      startup:{status:'verified',route:'/welcome',capture:{file,sha256:capture.sha256,format,method:capture.method}},cleanup:'verified',nativeReview:'pending',
      fullAcceptance:{status:'blocked',unperformed:ALPHA_SCENARIOS.slice(1)},at:new Date().toISOString()}};
  });
  // Extractor finally (including DMG detach) must finish before publishing a verified marker.
  const image=join(outputDir,result.receipt.startup.capture.file),json=join(outputDir,'startup.json');
  let imageOwned=false,jsonOwned=false;
  try {
    await writeFile(image,result.bytes,{flag:'wx',mode:0o600});imageOwned=true;
    await writeFile(json,`${JSON.stringify(result.receipt,null,2)}\n`,{flag:'wx',mode:0o600});jsonOwned=true;
  } catch(error) {
    if(jsonOwned)await rm(json);if(imageOwned)await rm(image);throw error;
  }
  return result.receipt;
}

export async function ciStartupOptions(args,{environment=process.env,repoRoot=fileURLToPath(new URL('../../../',import.meta.url))}={}) {
  if(environment.GITHUB_ACTIONS!=='true' || environment.RUNNER_ENVIRONMENT!=='github-hosted' || !isAbsolute(environment.RUNNER_TEMP??''))fail();
  const flags={};
  for(let i=0;i<args.length;i+=2) {
    if(!['--output-dir','--installed-app'].includes(args[i]) || flags[args[i]] || !args[i+1] || args[i+1].startsWith('--'))fail();
    flags[args[i]]=args[i+1];
  }
  if(!flags['--output-dir'] || (process.platform==='win32' ? !flags['--installed-app'] : flags['--installed-app']))fail();
  const temporaryRoot=await physicalDirectory(environment.RUNNER_TEMP),requested=resolve(flags['--output-dir']);
  const outputDir=join(await physicalDirectory(dirname(requested)),basename(requested));
  if(!inside(temporaryRoot,outputDir))fail();
  const source=JSON.parse(await readFile(join(repoRoot,'apps/desktop/package.json'),'utf8'));
  const expectedBuild=validateBuildInfo(JSON.parse(await readFile(join(repoRoot,'apps/desktop/resources/build-info.json'),'utf8')));
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']}).trim();
  if(expectedBuild.gitSha!==head || expectedBuild.version!==source.version || expectedBuild.platform!==process.platform || expectedBuild.arch!==process.arch)fail();
  const asset=join(repoRoot,'apps/desktop/dist-electron',startupAssetName(process.platform,process.arch,source.version));
  return {asset,expectedSha256:await hashFile(asset),expectedBuild,outputDir,temporaryRoot,...(flags['--installed-app']?{installedApp:resolve(flags['--installed-app'])}:{})};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {const result=await runNativeStartupProbe(await ciStartupOptions(process.argv.slice(2)));console.log(JSON.stringify(result));}
  catch {console.error(JSON.stringify({kind:'lawoss-ci-native-startup',status:'failed',reason:'native-startup-unverified'}));process.exitCode=1;}
}
