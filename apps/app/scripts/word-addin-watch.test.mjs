import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startBuildWatch, wordAddinWatchDirectories } from './word-addin-watch.mjs';

const until = async predicate => {
  const deadline=Date.now()+3000;
  while(!predicate()) { assert.ok(Date.now()<deadline,'watch event must settle');await new Promise(r=>setTimeout(r,10)); }
};

test('file changes during a build queue one fresh build; close drains it without deleting output',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'word-watch-'));let watcher;
  try {
    await mkdir(path.join(root,'nested'));await writeFile(path.join(root,'old-bundle.js'),'last good output');
    const releases=[];let started=0,active=0,maxActive=0;
    watcher=await startBuildWatch({directories:[{path:root,recursive:true}],debounceMs:10,run:async signal=>{
      started++;maxActive=Math.max(maxActive,++active);
      await new Promise(resolve=>{releases.push(resolve);signal.addEventListener('abort',resolve,{once:true});});active--;
    }});
    await until(()=>started===1);
    await writeFile(path.join(root,'nested/source.ts'),'first');await new Promise(r=>setTimeout(r,40));
    await writeFile(path.join(root,'nested/source.ts'),'second');await new Promise(r=>setTimeout(r,40));
    assert.equal(started,1);releases[0]();await until(()=>started===2);
    assert.equal(maxActive,1);await watcher.close();assert.equal(active,0);
    const {readFile}=await import('node:fs/promises');assert.equal(await readFile(path.join(root,'old-bundle.js'),'utf8'),'last good output');
    await writeFile(path.join(root,'nested/source.ts'),'after close');await new Promise(r=>setTimeout(r,40));assert.equal(started,2);
  } finally {await watcher?.close();await rm(root,{recursive:true,force:true});}
});

test('build error remains visible and an atomic source replacement still triggers recovery',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'word-watch-error-'));let watcher;
  try {
    const errors=[];let runs=0;
    watcher=await startBuildWatch({directories:[{path:root,recursive:true}],debounceMs:10,onError:e=>errors.push(e),run:async()=>{if(++runs===1)throw new Error('synthetic build failure');}});
    await until(()=>errors.length===1);assert.equal(errors[0].message,'synthetic build failure');
    const {rename}=await import('node:fs/promises');await writeFile(path.join(root,'source.tmp'),'fixed');await rename(path.join(root,'source.tmp'),path.join(root,'source.ts'));
    await until(()=>runs===2);await new Promise(r=>setTimeout(r,40));assert.equal(runs,2);
  } finally {await watcher?.close();await rm(root,{recursive:true,force:true});}
});

test('real configuration discovery watches CSS theme, Vite env, build identity and shared manifests',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'word-watch-config-'));let watcher;
  try {
    const app=path.join(root,'apps/app'),desktop=path.join(root,'apps/desktop'),shared=path.join(root,'packages/ui');
    for(const dir of [app,desktop,shared])await mkdir(dir,{recursive:true});
    let runs=0;watcher=await startBuildWatch({directories:wordAddinWatchDirectories(app),debounceMs:10,run:async()=>{runs++;}});
    await until(()=>runs===1);
    for(const file of [path.join(app,'tailwind.config.ts'),path.join(app,'.env.production.local'),path.join(desktop,'package.json'),path.join(shared,'package.json')]){
      const before=runs;await writeFile(file,'synthetic config');await until(()=>runs>before);await new Promise(r=>setTimeout(r,30));assert.equal(runs,before+1);
    }
    const before=runs;await mkdir(path.join(app,'dist-word-addin'));await writeFile(path.join(app,'dist-word-addin/output.js'),'build output');await new Promise(r=>setTimeout(r,40));assert.equal(runs,before,'output writes must not start a build loop');
  } finally {await watcher?.close();await rm(root,{recursive:true,force:true});}
});
