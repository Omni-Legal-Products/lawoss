import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectSyntheticRemainder } from './inspect-cleanup.js';

test('cleanup metadata reveals locked DB roles without names, absolute paths or contents',async()=>{
  const root=await mkdtemp(join(tmpdir(),'synthetic-cleanup-'));
  try {
    await writeFile(join(root,'runtime.sqlite'),'private contents');
    await mkdir(join(root,'secret-client'));
    await writeFile(join(root,'secret-client','credential-secret.txt'),'private credentials');
    const result=await inspectSyntheticRemainder(root);
    expect(result.entries).toContainEqual({depth:0,type:'file',role:'runtime-db'});
    expect(result.entries).toContainEqual({depth:1,type:'file',role:'other'});
    expect(JSON.stringify(result)).not.toMatch(/secret|private|credential|synthetic-cleanup/);
  }finally{await rm(root,{recursive:true,force:true});}
});
