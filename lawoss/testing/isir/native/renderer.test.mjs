import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('native renderer serves the built app and rejects a missing build without a dev fallback', async () => {
  const renderer = await import('./renderer.mjs').catch(error => { if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error; });
  assert.equal(typeof renderer?.nativeRendererLaunch,'function','Native bootstrap needs a built-renderer launch adapter');
  const root=await mkdtemp(path.join(tmpdir(),'native-renderer-test-'));
  try {
    await assert.rejects(renderer.nativeRendererLaunch(root,4321),{code:'ENOENT'});
    await mkdir(path.join(root,'dist'));
    await assert.rejects(renderer.nativeRendererLaunch(root,4321),{code:'ENOENT'});
    await writeFile(path.join(root,'dist/index.html'),'<!doctype html><title>Synthetic built renderer</title>');
    assert.deepEqual(await renderer.nativeRendererLaunch(root,4321),{
      cwd:root,args:['preview','--host','127.0.0.1','--port','4321','--strictPort'],
    });
  } finally { await rm(root,{recursive:true,force:true}); }
});
