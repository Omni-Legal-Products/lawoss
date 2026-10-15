import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Exact Bun 1.3.14 source supports this monitor without suppressing the default
// rejection path. All labels below are untrusted observed shapes, never causes.
export const EXPERIMENT='public-windows-compile-monitor-v1';
export const SOURCE='16747470f976aca3d362ad730bcd3fe82ecc2c9a';
export const PREFIX='LAWOSS_PUBLIC_COMPILE_MONITOR ';
export const PRIVATE_LIMIT=2*1024*1024;
export const CONFIG_NAME='engine-compile-monitor.private.json';
export const MANIFEST_NAME='engine-compile-monitor.manifest.json';
export const CODES=['ERR_UNKNOWN_BUILTIN_MODULE','MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND','RESOLVE_ERROR'];
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const bounded=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
export const keys=(v,names)=>{assert.ok(v!==null&&typeof v==='object'&&!Array.isArray(v));assert.deepEqual(Object.keys(v).sort(),[...names].sort());};
const within=(root,file)=>{const rel=path.relative(root,file);return rel!==''&&rel!=='..'&&!rel.startsWith(`..${path.sep}`)&&!path.isAbsolute(rel);};
const identity=file=>process.platform==='win32'?file.toLowerCase():file;
const canonical=file=>fs.realpathSync.native(file);
function regular(file,root){const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink());const real=canonical(file);assert.ok(within(root,real));assert.equal(identity(real),identity(path.resolve(file)));return real;}
export function validateManifest(value) {
  keys(value,['sourceCommit','files']);assert.equal(value.sourceCommit,SOURCE);
  assert.ok(Array.isArray(value.files)&&value.files.length<=8192);
  let previous=null;const seen=new Set();
  for(const row of value.files){keys(row,['path','blob']);assert.equal(typeof row.path,'string');assert.ok(row.path.length>0&&!row.path.includes('\\')&&!row.path.includes('\0')&&!path.posix.isAbsolute(row.path)&&!path.win32.isAbsolute(row.path));
    assert.ok(row.path.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'&&!part.includes(':')));
    assert.match(row.blob,/^[a-f0-9]{40}$/);assert.ok(previous===null||Buffer.compare(Buffer.from(previous),Buffer.from(row.path))<0);previous=row.path;
    const key=row.path.toLowerCase();assert.ok(!seen.has(key));seen.add(key);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(value))<=PRIVATE_LIMIT);return value;
}
export function prepareSourceMap(root,entry,manifest) {
  validateManifest(manifest);assert.ok(path.isAbsolute(root)&&path.isAbsolute(entry));const canonicalRoot=canonical(root);assert.equal(identity(canonicalRoot),identity(root));
  const entryReal=regular(entry,canonicalRoot),map=new Map();
  for(let index=0;index<manifest.files.length;index++){
    const real=regular(path.resolve(root,manifest.files[index].path),canonicalRoot),key=identity(real);assert.ok(!map.has(key));
    map.set(key,{sourceIndex:index,sourceRole:identity(real)===identity(entryReal)?'build-script':'workspace'});
  }
  return map;
}
export function matchesEntry(config,argv=process.argv) {
  try {assert.ok(Array.isArray(argv)&&Array.isArray(config.argv));assert.deepEqual(argv,config.argv);assert.ok(path.isAbsolute(config.entry));
    assert.equal(identity(regular(config.entry,canonical(config.root))),identity(config.entry));assert.equal(identity(canonical(argv[1])),identity(config.entry));return true;
  }catch{return false;}
}
const read=(object,key)=>{try{return {ok:true,value:object?.[key]};}catch{return {ok:false,value:undefined};}};
const emptyPosition=status=>({status,sourceRole:'unknown',sourceIndex:null,line:null,column:null,length:null,offset:null});
function projectPosition(error,map) {
  const field=read(error,'position');if(!field.ok)return emptyPosition('uninspectable');
  if(field.value==null)return emptyPosition('absent');if(typeof field.value!=='object')return emptyPosition('invalid');
  const result=emptyPosition('present');let invalid=false;
  for(const key of ['line','column','length','offset']){const supplied=read(field.value,key);if(!supplied.ok)return emptyPosition('uninspectable');
    if(bounded(supplied.value,2147483647))result[key]=supplied.value;else invalid=true;}
  if(invalid)return emptyPosition('invalid');
  const file=read(field.value,'file');if(!file.ok)return emptyPosition('uninspectable');
  if(typeof file.value==='string')try{
    const candidate=file.value.startsWith('file:')?fileURLToPath(file.value):file.value;
    // Pure lookup only. No path normalization, suffix inference or IO here.
    if(path.isAbsolute(candidate)){const found=map.get(identity(candidate));if(found){result.sourceRole=found.sourceRole;result.sourceIndex=found.sourceIndex;}}
  }catch{/* an invalid file URL has no source identity */}
  return result;
}
function projectError(error,map) {
  const name=read(error,'name');const errorClass=!name.ok?'uninspectable':['AggregateError','BuildMessage','ResolveMessage','Error'].includes(name.value)?name.value:'other';
  const supplied=read(error,'code');const code=!supplied.ok?'uninspectable':supplied.value===undefined?'absent':CODES.includes(supplied.value)?supplied.value:'other';
  return {errorClass,code,position:projectPosition(error,map)};
}
export function projectException(error,origin,map,mode) {
  const root=projectError(error,map);const result={schemaVersion:1,experiment:EXPERIMENT,kind:'exception',mode,
    origin:['uncaughtException','unhandledRejection'].includes(origin)?origin:origin===undefined?'uninspectable':'other',inspection:'observed',root,
    aggregateTotal:0,aggregateOmitted:0,countsClamped:false,members:[],membersLimitReached:false};
  if(root.errorClass==='uninspectable')result.inspection='failed';
  if(root.errorClass==='AggregateError'){
    const errors=read(error,'errors');let array=false;try{array=errors.ok&&Array.isArray(errors.value);}catch{/* revoked proxy */}
    const length=array?read(errors.value,'length'):{ok:false};
    if(!length.ok||!bounded(length.value,4294967295)){result.inspection='failed';result.aggregateTotal=null;result.aggregateOmitted=null;return result;}
    result.aggregateTotal=Math.min(length.value,65535);result.countsClamped=length.value>65535;
    for(let i=0;i<Math.min(length.value,8);i++){const member=read(errors.value,i);result.members.push(member.ok?projectError(member.value,map):{errorClass:'uninspectable',code:'uninspectable',position:emptyPosition('uninspectable')});}
    result.aggregateOmitted=result.aggregateTotal-result.members.length;result.membersLimitReached=length.value>8;
  }
  return result;
}
function readPrivate(file){
  const before=fs.lstatSync(file);assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.size<=PRIVATE_LIMIT);
  const fd=fs.openSync(file,'r');
  try{const opened=fs.fstatSync(fd);assert.ok(opened.isFile()&&opened.dev===before.dev&&opened.ino===before.ino&&opened.size<=PRIVATE_LIMIT);
    const bytes=Buffer.alloc(PRIVATE_LIMIT+1);let size=0;
    while(size<bytes.length){const count=fs.readSync(fd,bytes,size,bytes.length-size,size);if(!count)break;size+=count;}
    assert.ok(size<=PRIVATE_LIMIT);const after=fs.lstatSync(file);assert.ok(!after.isSymbolicLink()&&after.dev===opened.dev&&after.ino===opened.ino);return bytes.subarray(0,size);
  }finally{fs.closeSync(fd);}
}
function initialize() {
  // Ordinary module imports are inert; only the exact explicitly selected owned
  // copy may initialize. Descendants must also match the complete frozen argv.
  if(!process.env.BUN_INSPECT_PRELOAD)return;
  const self=fileURLToPath(import.meta.url);if(identity(path.resolve(process.env.BUN_INSPECT_PRELOAD))!==identity(self))return;
  try{
    const directory=path.dirname(self),configBytes=readPrivate(path.join(directory,CONFIG_NAME));
    const config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(configBytes));
    keys(config,['root','entry','argv','mode','manifestSha256']);assert.ok(['capability','build'].includes(config.mode));assert.match(config.manifestSha256,/^[a-f0-9]{64}$/);
    // Owner writes canonical compact JSON; reject ambiguous duplicate-key files.
    assert.equal(JSON.stringify(config),configBytes.toString('utf8'));
    if(!matchesEntry(config))return;
    const manifestBytes=readPrivate(path.join(directory,MANIFEST_NAME));assert.equal(sha(manifestBytes),config.manifestSha256);
    const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));assert.equal(JSON.stringify(manifest),manifestBytes.toString('utf8'));
    const map=prepareSourceMap(config.root,config.entry,manifest);
    const emit=value=>{try{const bytes=Buffer.from(`${PREFIX}${JSON.stringify(value)}\n`);if(bytes.length<=4096)fs.writeSync(2,bytes);}catch{/* absent evidence stays unknown */}};
    let used=false;
    process.on('uncaughtExceptionMonitor',(error,origin)=>{
      if(used)return;used=true;
      try{emit(projectException(error,origin,map,config.mode));}catch{emit({schemaVersion:1,experiment:EXPERIMENT,kind:'exception',mode:config.mode,origin:'uninspectable',inspection:'failed',root:{errorClass:'uninspectable',code:'uninspectable',position:emptyPosition('uninspectable')},aggregateTotal:null,aggregateOmitted:null,countsClamped:false,members:[],membersLimitReached:false});}
    });
    emit({schemaVersion:1,experiment:EXPERIMENT,kind:'registered',mode:config.mode,manifestSha256:config.manifestSha256});
  }catch{/* No acknowledgment, no listener: initialization failure is unknown. */}
}
initialize();
