import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { publishNativeQuitAcceptance, readNativeQuitAcceptance } from './quit-acceptance.mjs';

function owned(t) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'quit-receipt-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const launch={root,nonce:'a'.repeat(64),pid:700021};
  return {launch,file:path.join(root,`quit-acceptance-${launch.nonce}.json`)};
}
test('main publishes bounded complete receipt exclusively and controller binds exact launch child',t=>{
  const {launch,file}=owned(t);assert.equal(readNativeQuitAcceptance(launch),false);
  const link=fs.linkSync;let atPublication;
  fs.linkSync=(from,to)=>{atPublication={finalExists:fs.existsSync(to),bytes:fs.readFileSync(from)};link(from,to);};
  try {publishNativeQuitAcceptance(launch);} finally {fs.linkSync=link;}
  assert.equal(atPublication.finalExists,false);assert.ok(atPublication.bytes.length<200);
  assert.deepEqual(JSON.parse(atPublication.bytes),{schema:1,nonce:launch.nonce,pid:launch.pid,accepted:true});
  assert.equal(atPublication.bytes.includes(Buffer.from(launch.root)),false);
  assert.equal(readNativeQuitAcceptance(launch),true);
  assert.equal(readNativeQuitAcceptance({...launch,pid:launch.pid+1}),false);
  assert.equal(readNativeQuitAcceptance({...launch,nonce:'b'.repeat(64)}),false);
  assert.throws(()=>publishNativeQuitAcceptance(launch),{code:'EEXIST'});
  assert.equal(fs.existsSync(file+'.pending'),false);assert.equal(readNativeQuitAcceptance(launch),true);
});
for(const [name,value] of [
  ['malformed','{'],['oversized','x'.repeat(4096)],['invalid UTF8',Buffer.from([255])],
  ['duplicate fields','{"schema":1,"schema":1}'],
  ['foreign pid',{schema:1,nonce:'a'.repeat(64),pid:700022,accepted:true}],
  ['stale nonce',{schema:1,nonce:'b'.repeat(64),pid:700021,accepted:true}],
  ['extra path',{schema:1,nonce:'a'.repeat(64),pid:700021,accepted:true,path:'/client'}],
  ['unaccepted',{schema:1,nonce:'a'.repeat(64),pid:700021,accepted:false}],
])test(`receipt refuses ${name} bytes`,t=>{
  const {launch,file}=owned(t);fs.writeFileSync(file,Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value)+'\n');
  assert.equal(readNativeQuitAcceptance(launch),false);
});
test('receipt refuses symlink final, pending and root without following them',t=>{
  const {launch,file}=owned(t),other=path.join(launch.root,'other');fs.writeFileSync(other,'untouched');
  fs.symlinkSync(other,file);assert.equal(readNativeQuitAcceptance(launch),false);
  assert.throws(()=>publishNativeQuitAcceptance(launch),{code:'EEXIST'});assert.equal(fs.readFileSync(other,'utf8'),'untouched');
  fs.unlinkSync(file);fs.symlinkSync(other,file+'.pending');assert.throws(()=>publishNativeQuitAcceptance(launch),{code:'EEXIST'});
  const alias=path.join(launch.root,'alias');fs.symlinkSync(launch.root,alias,'junction');
  assert.throws(()=>readNativeQuitAcceptance({...launch,root:alias}),/canonical and owned/);
});
test('receipt refuses hard-linked final and a directory rather than unbounded reading',t=>{
  const {launch,file}=owned(t);publishNativeQuitAcceptance(launch);fs.linkSync(file,path.join(launch.root,'copy'));
  assert.equal(readNativeQuitAcceptance(launch),false);fs.unlinkSync(file);fs.mkdirSync(file);assert.equal(readNativeQuitAcceptance(launch),false);
});
test('receipt write and read I/O failures keep their original Error objects',t=>{
  const {launch}=owned(t),write=new Error('synthetic write failed'),read=new Error('synthetic read failed');
  const originalWrite=fs.writeFileSync;fs.writeFileSync=()=>{throw write;};
  try {assert.throws(()=>publishNativeQuitAcceptance(launch),error=>error===write);} finally {fs.writeFileSync=originalWrite;}
  publishNativeQuitAcceptance(launch);
  const originalRead=fs.readSync;fs.readSync=()=>{throw read;};
  try {assert.throws(()=>readNativeQuitAcceptance(launch),error=>error===read);} finally {fs.readSync=originalRead;}
});
test('receipt rejects invalid launch contexts without creating a file',t=>{
  const {launch}=owned(t);
  for(const patch of [{root:'relative'},{nonce:'../outside'},{nonce:undefined},{pid:1},{pid:1.5}])assert.throws(()=>publishNativeQuitAcceptance({...launch,...patch}),/Invalid native quit launch context/);
  assert.deepEqual(fs.readdirSync(launch.root),[]);
});
