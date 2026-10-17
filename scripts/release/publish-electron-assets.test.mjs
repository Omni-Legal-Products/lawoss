import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createChecksums } from './checksums.mjs';
import { createReleaseEvidence, REQUIRED_NATIVE_SCENARIOS, evidenceFilename, sha256 } from './release-evidence.mjs';

test('single promotion verifies final target bytes, all referenced architectures, manifests and immutable uploads',async t=>{
 const root=await mkdtemp(join(tmpdir(),'lawoss-promotion-'));t.after(()=>rm(root,{recursive:true,force:true}));const dist=join(root,'dist'),remote=join(root,'remote'),log=join(root,'uploads.jsonl');await mkdir(remote);
 await writeFile(join(root,'gh'),`#!/usr/bin/env node
const fs=require('node:fs'),p=require('node:path');const args=process.argv.slice(2);const remote=process.env.REMOTE;
if(args[1]==='view'){console.log(JSON.stringify({isDraft:false,assets:fs.readdirSync(remote).map(name=>({name}))}));}
else if(args[1]==='download'){fs.copyFileSync(p.join(remote,args[args.indexOf('--pattern')+1]),p.join(args[args.indexOf('--dir')+1],args[args.indexOf('--pattern')+1]));}
else if(args[1]==='upload'){if(args.includes('--clobber'))throw new Error('immutable clobber');fs.appendFileSync(process.env.UPLOAD_LOG,JSON.stringify(args)+'\\n');for(const file of args.slice(3,args.indexOf('--repo')))fs.copyFileSync(file,p.join(remote,p.basename(file)));}
else throw new Error('unexpected gh');
`,{mode:0o755});
 const payloads=[];let winManifest;
 for(const platform of ['darwin','win32'])for(const arch of ['arm64','x64']){
  const dir=join(dist,`${platform}-${arch}`);await mkdir(dir,{recursive:true});const name=`lawoss-${platform==='darwin'?'mac':'win'}-${arch}-1.0.0.${platform==='darwin'?'zip':'exe'}`,file=join(dir,name),bytes=Buffer.from(`final ${platform} ${arch}`);await writeFile(file,bytes);await copyFile(file,join(remote,name));payloads.push(file);
  const digest=sha256(bytes),at='2026-10-17T00:00:00Z',evidenceUrl='https://example.invalid/native';
  const evidence=createReleaseEvidence({build:{schemaVersion:1,product:'lawoss-desktop',version:'1.0.0',gitSha:'a'.repeat(40),buildEpoch:'123',platform,arch,channel:'stable',workflowRunUrl:evidenceUrl},releaseTag:'v1.0.0',assets:[{name,size:bytes.length,sha256:digest}],receipts:['built','signed','tested'].map(state=>({state,at,actor:'fixture',evidenceUrl,assetSha256:digest})),signing:{status:'verified',evidenceUrl},acceptance:REQUIRED_NATIVE_SCENARIOS.flatMap(scenario=>['fresh','migrated'].map(profile=>({scenario,profile,status:'pass',assetSha256:digest,evidenceUrl})))});
  await writeFile(join(dir,evidenceFilename(evidence.build)),JSON.stringify(evidence));await writeFile(join(dir,'SHA256SUMS'),await createChecksums([file]));
  const manifest=join(dir,platform==='darwin'?'latest-mac.yml':arch==='arm64'?'latest-arm64.yml':'latest.yml');await writeFile(manifest,`version: 1.0.0\nfiles:\n  - url: ${name}\n    sha512: ${createHash('sha512').update(bytes).digest('base64')}\n`);if(platform==='win32'&&arch==='x64')winManifest=manifest;
 }
 const run=()=>spawnSync(process.execPath,[fileURLToPath(new URL('./publish-electron-assets.mjs',import.meta.url)),'--manifests-only',dist,'v1.0.0'],{encoding:'utf8',env:{...process.env,PATH:`${root}${delimiter}${process.env.PATH}`,RUNNER_TEMP:root,REMOTE:remote,UPLOAD_LOG:log,RELEASE_REPOSITORY:'fixture/repo'}});
 const result=run();assert.equal(result.status,0,result.stderr);const calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(calls.length,1);assert.ok(!calls[0].includes('--clobber'));assert.equal(await readFile(join(remote,'SHA256SUMS'),'utf8'),await createChecksums(payloads));
 assert.match(await readFile(join(remote,'latest-mac.yml'),'utf8'),/mac-x64/);assert.doesNotMatch(await readFile(join(remote,'latest.yml'),'utf8'),/arm64/);assert.ok((await readdir(remote)).includes('promotion-latest-mac.yml.json'));
 const repeat=run();assert.equal(repeat.status,0,repeat.stderr);assert.equal((await readFile(log,'utf8')).trim().split('\n').length,1);
 const original=await readFile(winManifest,'utf8');await writeFile(winManifest,original+'  - url: lawoss-win-arm64-1.0.0.exe\n    sha512: fixture\n');const mixed=run();assert.notEqual(mixed.status,0);assert.match(mixed.stderr,/only Windows x64/);await writeFile(winManifest,original);
 await writeFile(join(remote,'lawoss-win-x64-1.0.0.exe'),'changed after upload');const changed=run();assert.notEqual(changed.status,0);assert.match(changed.stderr,/bytes differ/);assert.equal((await readFile(log,'utf8')).trim().split('\n').length,1);
 await rm(join(dist,'darwin-x64','release-evidence-darwin-x64.json'));const incomplete=run();assert.notEqual(incomplete.status,0);assert.match(incomplete.stderr,/Missing validated target|missing.*target|Unowned release payload/i);
});

test('refuses payload without target evidence before first upload',async t=>{const root=await mkdtemp(join(tmpdir(),'missing-evidence-'));t.after(()=>rm(root,{recursive:true,force:true}));const dist=join(root,'dist');await mkdir(dist);await writeFile(join(dist,'lawoss-win-x64-1.0.0.exe'),'final');await writeFile(join(dist,'latest.yml'),'version: 1.0.0\nfiles:\n  - url: lawoss-win-x64-1.0.0.exe\n    sha512: fixture\n');await writeFile(join(root,'gh'),'#!/bin/sh\nexit 0\n',{mode:0o755});const result=spawnSync(process.execPath,[fileURLToPath(new URL('./publish-electron-assets.mjs',import.meta.url)),dist,'v1.0.0'],{encoding:'utf8',env:{...process.env,PATH:`${root}${delimiter}${process.env.PATH}`,GITHUB_REPOSITORY:'fixture/repo',RELEASE_REPOSITORY:'',RUNNER_TEMP:root}});assert.notEqual(result.status,0);assert.match(result.stderr,/evidence/i);});
