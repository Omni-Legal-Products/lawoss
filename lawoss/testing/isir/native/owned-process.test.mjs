import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { stopNativeChild } from './owned-process.mjs';

test('already exited native child is not signalled again',async()=>{
  const child=spawn(process.execPath,['-e','process.exit(0)'],{detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  await once(child,'exit');await stopNativeChild(child,100);
  assert.equal(child.exitCode,0);
});
test('native child that ignores graceful stop is awaited through force stop',async()=>{
  const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  try {await once(child.stdout,'data');await stopNativeChild(child,100);assert.ok(child.exitCode!==null||child.signalCode!==null);}
  finally {if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
});
