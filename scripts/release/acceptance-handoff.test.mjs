import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { stageAcceptanceCandidate, packAcceptance, resumeAcceptance } from './acceptance-handoff.mjs';
import { initialEvidence, fakeGh } from './release-test-fixtures.mjs';
import { evidenceFilename, REQUIRED_NATIVE_SCENARIOS, sha256 } from './release-evidence.mjs';
const source={repository:'fixture/repo',runId:'9',runAttempt:'1',headSha:'a'.repeat(40),workflowPath:'.github/workflows/alpha-macos-aarch64.yml'};
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'acceptance-handoff-'));t.after(()=>rm(root,{recursive:true,force:true}));const assets=join(root,'assets');await mkdir(assets);const evidence=initialEvidence();const manifestName='latest-mac-arm64.yml';const manifest=`version: ${evidence.build.version}\nfiles:\n  - url: ${evidence.assets[0].name}\n    sha512: ${createHash('sha512').update('final').digest('base64')}\n`;await writeFile(join(assets,evidence.assets[0].name),'final');await writeFile(join(assets,manifestName),manifest);await writeFile(join(assets,'latest-mac.yml'),manifest);evidence.assets.push({name:manifestName,size:Buffer.byteLength(manifest),sha256:sha256(manifest)});await writeFile(join(assets,evidenceFilename(evidence.build)),JSON.stringify(evidence));await writeFile(join(assets,'SHA256SUMS'),`${evidence.assets[0].sha256}  ${evidence.assets[0].name}\n`);
 const candidateDir=join(root,'candidate');const staged=await stageAcceptanceCandidate({assetsDir:assets,outDir:candidateDir,source});
 const receipts=[];for(const profile of ['fresh','migrated']){const capture=join(root,`${profile}.png`);await writeFile(capture,`synthetic ${profile} capture`);const receipt={schemaVersion:1,status:'pass',build:evidence.build,profile,profileOwner:`synthetic-${profile}`,assetSha256:evidence.assets[0].sha256,operator:'synthetic test operator',evidenceUrl:'https://example.invalid/native',at:'2026-10-17T01:00:00Z',acceptance:REQUIRED_NATIVE_SCENARIOS.map(scenario=>({scenario,profile,assetSha256:evidence.assets[0].sha256,status:'pass',evidenceUrl:'https://example.invalid/native'})),native:{profileKind:profile,build:evidence.build,assetSha256:evidence.assets[0].sha256,legalworkDevMode:false,signature:{status:'verified',method:'codesign-spctl-and-installer-tree'},attachments:[{scenario:'onboarding',path:capture,sha256:sha256(`synthetic ${profile} capture`)}]}};const path=join(root,`${profile}.json`);await writeFile(path,JSON.stringify(receipt));receipts.push(path);}
 const intake=await packAcceptance({candidateDir,receiptPaths:receipts});const remote=fakeGh();let exists=false,draft=true;const calls=[];const artifactName=staged.artifactName;let pointer;let pointerExists=false;
 const gh=async args=>{
  calls.push(args);
  if(args[0]==='release'&&args[2]==='alpha-macos-latest'){
    if(args[1]==='view'){if(!pointerExists){const e=new Error('Not Found');e.status=404;throw e;}return JSON.stringify({tagName:'alpha-macos-latest',isDraft:false,assets:pointer?[{name:'latest-mac.yml',id:900}]:[]});}
    if(args[1]==='create'){pointerExists=true;remote.effects.push(['create-pointer','alpha-macos-latest']);return '';}
    if(args[1]==='upload'){pointer=await readFile(args[3]);remote.effects.push(['pointer','latest-mac.yml']);return '';}
    if(args[1]==='download'){await writeFile(join(args[args.indexOf('--dir')+1],'latest-mac.yml'),pointer);return '';}
  }

  if(args[0]==='api'&&args[1]===`repos/fixture/repo/actions/runs/9/attempts/1`)return JSON.stringify({id:9,run_attempt:1,head_sha:source.headSha,path:source.workflowPath,event:'workflow_dispatch',status:'completed',repository:{full_name:'fixture/repo'}});
  if(args[0]==='api'&&args[1]===`repos/fixture/repo/actions/runs/9/artifacts`)return JSON.stringify([{artifacts:[{name:artifactName,expired:false,workflow_run:{id:9,head_sha:source.headSha}}]}]);
  if(args[0]==='run'&&args[1]==='download'){assert.equal(args[2],'9');assert.equal(args[args.indexOf('--name')+1],artifactName);await cp(candidateDir,args[args.indexOf('--dir')+1],{recursive:true});return '';}
  if(args[0]==='release'&&args[1]==='view'){if(!exists){const error=new Error('Not Found');error.status=404;throw error;}const state=JSON.parse(await remote.gh(args));return JSON.stringify({...state,isDraft:draft});}
  if(args[0]==='release'&&args[1]==='create'){exists=true;remote.effects.push(['create',args[2]]);return '';}
  if(args[0]==='api'&&args[1].startsWith('repos/fixture/repo/git/ref/tags/'))return JSON.stringify({object:{type:'commit',sha:evidence.build.gitSha}});
  if(args[0]==='release'&&args[1]==='edit'){draft=false;remote.effects.push(['publish',args[2]]);return '';}
  return remote.gh(args);
 };
 const intakePath=join(root,'intake.json');await writeFile(intakePath,JSON.stringify(intake));
 return{root,assets,evidence,staged,candidateDir,intake,intakePath,remote,gh,calls,setExists:()=>{exists=true;},getDraft:()=>draft};
}
test('preserves installer/evidence, imports exact original run and resumes draft without rebuild; retry is idempotent',async t=>{const f=await fixture(t);assert.equal(await readFile(join(f.candidateDir,f.evidence.assets[0].name),'utf8'),'final');const opts={repo:'fixture/repo',sourceRunId:'9',intakePath:f.intakePath,outDir:join(f.root,'resume'),gh:f.gh};const result=await resumeAcceptance(opts);assert.equal(result.status,'accepted-draft');assert.equal(result.targets[0].build.version,'1.2.3-alpha.9');assert.equal(result.targets[0].releaseTag,'alpha-original-run-9');assert.equal(result.targets[0].build.gitSha,source.headSha);assert.ok(f.getDraft());const canonical=JSON.parse(f.remote.assets.get(evidenceFilename(f.evidence.build)).bytes);assert.ok(canonical.receipts.some(x=>x.state==='tested'));assert.equal(canonical.evidenceHistory.length,1);assert.ok(!f.calls.some(args=>args.includes('--clobber')));const count=f.remote.effects.length;await resumeAcceptance({...opts,outDir:join(f.root,'retry')});assert.equal(f.remote.effects.length,count);});
test('stale installer, other SHA, wrong source run and incomplete migrated receipt refuse every release effect',async t=>{for(const kind of ['bytes','sha','source-run','not-run']){const f=await fixture(t);if(kind==='bytes')await writeFile(join(f.candidateDir,f.evidence.assets[0].name),'stale bytes');else if(kind==='sha')f.intake.targets[0].receipts[0].build={...f.evidence.build,gitSha:'b'.repeat(40)};else if(kind==='source-run')f.intake.source.runId='8';else f.intake.targets[0].receipts[1].status='blocked';await writeFile(f.intakePath,JSON.stringify(f.intake));await assert.rejects(resumeAcceptance({repo:'fixture/repo',sourceRunId:'9',intakePath:f.intakePath,outDir:join(f.root,'resume'),gh:f.gh}),/bytes|digest|identity|source|pass|run/i);assert.equal(f.remote.effects.length,0);}});
test('different acceptance replay and immutable remote payload collision refuse replacement',async t=>{const f=await fixture(t);const opts={repo:'fixture/repo',sourceRunId:'9',intakePath:f.intakePath,outDir:join(f.root,'resume'),gh:f.gh};await resumeAcceptance(opts);const count=f.remote.effects.length;f.intake.targets[0].receipts[0].operator='different operator';await writeFile(f.intakePath,JSON.stringify(f.intake));await assert.rejects(resumeAcceptance({...opts,outDir:join(f.root,'replay')}),/replay|handoff/i);assert.equal(f.remote.effects.length,count);const other=await fixture(t);other.setExists();other.remote.put(other.evidence.assets[0].name,'changed bytes');await assert.rejects(resumeAcceptance({repo:'fixture/repo',sourceRunId:'9',intakePath:other.intakePath,outDir:join(other.root,'collision'),gh:other.gh}),/immutable|collision/i);assert.equal(other.remote.effects.length,0);});

test('public resume writes published canonical snapshots before actual pointer promotion; complete retry has no effects',async t=>{
 const f=await fixture(t);const opts={repo:'fixture/repo',sourceRunId:'9',intakePath:f.intakePath,outDir:join(f.root,'public'),publish:true,gh:f.gh};const result=await resumeAcceptance(opts);assert.equal(result.status,'published-and-promoted');assert.equal(f.getDraft(),false);const canonical=JSON.parse(f.remote.assets.get(evidenceFilename(f.evidence.build)).bytes);assert.equal(canonical.evidenceHistory.length,2);assert.ok(canonical.receipts.some(x=>x.state==='published'));const pointerIndex=f.remote.effects.findIndex(x=>x[0]==='pointer');assert.ok(pointerIndex>f.remote.effects.map(x=>x[1]).lastIndexOf(evidenceFilename(f.evidence.build)));const count=f.remote.effects.length;await resumeAcceptance({...opts,outDir:join(f.root,'public-retry')});assert.equal(f.remote.effects.length,count);assert.ok(f.calls.filter(x=>x.includes('--clobber')).every(x=>x[2]==='alpha-macos-latest'));
});

test('successful CI intake artifact is collected and revalidated without release effects; foreign intake run is refused',async t=>{
 const {collectAcceptanceIntakes}=await import('./acceptance-handoff.mjs');const f=await fixture(t);let foreign=false;const gh=async args=>{
  if(args[0]==='api'&&args[1]==='repos/fixture/repo/actions/runs/100')return JSON.stringify({id:100,repository:{full_name:foreign?'foreign/repo':'fixture/repo'},path:'.github/workflows/release-acceptance-resume.yml',event:'workflow_dispatch',status:'completed',conclusion:'success',head_sha:'c'.repeat(40)});
  if(args[0]==='api'&&args[1]==='repos/fixture/repo/actions/runs/100/artifacts')return JSON.stringify([{artifacts:[{name:'release-native-intake-9-100',expired:false,workflow_run:{id:100,head_sha:'c'.repeat(40)}}]}]);
  if(args[0]==='run'&&args[2]==='100'){const dir=args[args.indexOf('--dir')+1];await mkdir(dir,{recursive:true});await cp(f.intakePath,join(dir,'intake.json'));return '';}
  return f.gh(args);
 };
 const out=join(f.root,'collected');await collectAcceptanceIntakes({repo:'fixture/repo',sourceRunId:'9',intakeRunIds:['100'],outDir:out,gh});
 const result=await resumeAcceptance({repo:'fixture/repo',sourceRunId:'9',intakePath:join(out,'intake.json'),outDir:join(f.root,'intake-validation'),validateOnly:true,gh});assert.equal(result.status,'validated-native-intake');assert.equal(f.remote.effects.length,0);
 foreign=true;await assert.rejects(collectAcceptanceIntakes({repo:'fixture/repo',sourceRunId:'9',intakeRunIds:['100'],outDir:join(f.root,'foreign-intake'),gh}),/foreign/i);assert.equal(f.remote.effects.length,0);
});

test('missing remote historical evidence prevents public release and pointer promotion',async t=>{
 const f=await fixture(t);const opts={repo:'fixture/repo',sourceRunId:'9',intakePath:f.intakePath,outDir:join(f.root,'draft-accepted'),gh:f.gh};await resumeAcceptance(opts);
 const snapshot=[...f.remote.assets.keys()].find(name=>name.includes('-sha256-'));f.remote.assets.delete(snapshot);const count=f.remote.effects.length;
 await assert.rejects(resumeAcceptance({...opts,outDir:join(f.root,'must-not-publish'),publish:true}),/chain|snapshot/i);assert.equal(f.remote.effects.length,count);assert.ok(f.getDraft());
});

test('an existing foreign tag with no release is refused before creating or uploading anything',async t=>{
 const f=await fixture(t);const gh=async args=>args[0]==='api'&&args[1].includes('/git/ref/tags/')?JSON.stringify({object:{type:'commit',sha:'b'.repeat(40)}}):f.gh(args);
 await assert.rejects(resumeAcceptance({repo:'fixture/repo',sourceRunId:'9',intakePath:f.intakePath,outDir:join(f.root,'foreign-tag'),gh}),/foreign source SHA/);assert.equal(f.remote.effects.length,0);
});

test('resumption after published canonical upload failure recovers the last full chain, not a new root',async t=>{
 const f=await fixture(t);let uploads=0;f.remote.setHook(args=>{if(args[1]==='upload'&&basename(args[3])===evidenceFilename(f.evidence.build)&&++uploads===3)throw new Error('Interrupted published canonical upload');});
 const opts={repo:'fixture/repo',sourceRunId:'9',intakePath:f.intakePath,outDir:join(f.root,'interrupted-public'),publish:true,gh:f.gh};await assert.rejects(resumeAcceptance(opts),/Interrupted/);assert.equal(f.remote.assets.has(evidenceFilename(f.evidence.build)),false);assert.ok(!f.remote.effects.some(effect=>effect[0]==='pointer'));
 const snapshots=[...f.remote.assets.keys()].filter(name=>name.includes('-sha256-'));assert.equal(snapshots.length,2);
 const result=await resumeAcceptance({...opts,outDir:join(f.root,'recovered-public')});assert.equal(result.status,'published-and-promoted');const canonical=JSON.parse(f.remote.assets.get(evidenceFilename(f.evidence.build)).bytes);assert.ok(canonical.evidenceHistory.length>=3);for(const name of snapshots)assert.ok(canonical.evidenceHistory.some(item=>item.name===name));assert.ok(canonical.receipts.some(receipt=>receipt.state==='published'));
});
