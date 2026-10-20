import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createReleaseEvidence, sha256 } from './release-evidence.mjs';
export function initialEvidence() {
  return createReleaseEvidence({ build: {schemaVersion:1,product:'lawoss-desktop',version:'1.2.3-alpha.9',gitSha:'a'.repeat(40),buildEpoch:'123',platform:'darwin',arch:'arm64',channel:'alpha',workflowRunUrl:'https://github.com/fixture/repo/actions/runs/9'},releaseTag:'alpha-original-run-9',assets:[{name:'lawoss-mac-arm64-1.2.3-alpha.9.dmg',size:5,sha256:sha256('final')}],receipts:[{state:'built',at:'2026-10-17T00:00:00Z',actor:'fixture',evidenceUrl:'https://example.invalid/build'}],signing:{status:'unverified',evidenceUrl:null},acceptance:[]});
}
export function fakeGh() {
  const assets=new Map();let nextId=1;const effects=[];let hook;
  const put=(name,bytes)=>assets.set(name,{id:nextId++,bytes:Buffer.from(bytes)});
  const gh=async args=>{
    if(hook)await hook(args);
    if(args[0]==='api'&&args[1].includes('/releases/tags/'))return JSON.stringify({tag_name:'alpha-original-run-9',draft:true,assets:[...assets].map(([name,x])=>({name,id:x.id}))});
    if(args[0]==='release'&&args[1]==='view')return JSON.stringify({tagName:'alpha-original-run-9',isDraft:true,assets:[...assets].map(([name,x])=>({name,id:x.id}))});
    if(args[0]==='release'&&args[1]==='download'){const name=args[args.indexOf('--pattern')+1];if(!assets.has(name))throw new Error('Missing remote fixture');await writeFile(join(args[args.indexOf('--dir')+1],name),assets.get(name).bytes);return '';}
    if(args[0]==='release'&&args[1]==='upload'){assert.ok(!args.includes('--clobber'),'no metadata/payload clobber');for(const file of args.slice(3,args.indexOf('--repo'))){const name=basename(file);if(assets.has(name))throw new Error('Fixture asset collision');put(name,await readFile(file));effects.push(['upload',name]);}return '';}
    if(args[0]==='api'&&args.includes('DELETE')){const id=Number(args[1].split('/').at(-1));const item=[...assets].find(([,x])=>x.id===id);if(!item)throw new Error('Stale asset id');assets.delete(item[0]);effects.push(['delete',item[0]]);return '';}
    throw new Error(`Unexpected gh fixture operation: ${args[0]} ${args[1]}`);
  };
  return {assets,effects,put,gh,setHook:fn=>hook=fn};
}
