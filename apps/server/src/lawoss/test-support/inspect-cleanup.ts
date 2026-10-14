import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** Test-owned synthetic roots only. No filenames, paths or bytes leave this projection. */
export async function inspectSyntheticRemainder(root: string) {
  const entries: Array<{depth:number;type:'file'|'directory'|'link'|'other';role:'runtime-db'|'runtime-db-sidecar'|'other'}> = [];
  const queue=[{path:root,depth:0}];
  while(queue.length && entries.length<128) {
    const current=queue.shift()!;
    for(const entry of await readdir(current.path,{withFileTypes:true})) {
      if(entries.length>=128)break;
      const type=entry.isSymbolicLink()?'link':entry.isDirectory()?'directory':entry.isFile()?'file':'other';
      const role=entry.name==='runtime.sqlite'?'runtime-db':/^runtime\.sqlite-(wal|shm|journal)$/.test(entry.name)?'runtime-db-sidecar':'other';
      entries.push({depth:current.depth,type,role});
      if(type==='directory' && current.depth<8)queue.push({path:join(current.path,entry.name),depth:current.depth+1});
    }
  }
  return {entries,capped:entries.length>=128||queue.length>0};
}

/** Preserve every failed removal, including locked live resources. Diagnostic only. */
export async function removeSyntheticTestDir(root: string): Promise<void> {
  try {await rm(root,{recursive:true,force:true});}
  catch(error) {
    const remainder=await inspectSyntheticRemainder(root).catch(()=>({unavailable:true}));
    console.error('Synthetic fixture cleanup remainder',JSON.stringify(remainder));
    throw error;
  }
}
