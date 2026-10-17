// Inert test-only main/controller handshake. No renderer, arbitrary RPC path,
// app import, polling, client files or production runtime mutation.
import fs from 'node:fs';
import path from 'node:path';

function context({root,nonce,pid}) {
  if (!path.isAbsolute(root??'') || !/^[a-f0-9]{64}$/.test(nonce??'') || !Number.isSafeInteger(pid) || pid<=1) throw new Error('Invalid native quit launch context');
  const stat=fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(root)!==root) throw new Error('Native quit root must be canonical and owned');
  return {file:path.join(root,`quit-acceptance-${nonce}.json`),bytes:Buffer.from(JSON.stringify({schema:1,nonce,pid,accepted:true})+'\n')};
}

export function publishNativeQuitAcceptance(launch) {
  const {file,bytes}=context(launch),pending=file+'.pending';
  // wx rejects existing files and symlinks. link publishes complete bytes
  // atomically without replacing a stale/foreign final receipt.
  fs.writeFileSync(pending,bytes,{flag:'wx',mode:0o600});
  try { fs.linkSync(pending,file); }
  finally { fs.unlinkSync(pending); }
}

export function readNativeQuitAcceptance(launch) {
  const {file,bytes}=context(launch);
  let stat;
  try { stat=fs.lstatSync(file); } catch(error) { if(error.code==='ENOENT')return false; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1 || stat.size!==bytes.length) return false;
  const fd=fs.openSync(file,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW??0));
  try {
    const before=fs.fstatSync(fd),buffer=Buffer.alloc(bytes.length+1);
    const count=fs.readSync(fd,buffer,0,buffer.length,0),after=fs.fstatSync(fd),current=fs.lstatSync(file);
    return before.isFile() && before.nlink===1 && before.dev===stat.dev && before.ino===stat.ino &&
      after.dev===before.dev && after.ino===before.ino && after.size===before.size && after.mtimeMs===before.mtimeMs &&
      !current.isSymbolicLink() && current.dev===before.dev && current.ino===before.ino && current.nlink===1 &&
      count===bytes.length && buffer.subarray(0,count).equals(bytes);
  } finally { fs.closeSync(fd); }
}
