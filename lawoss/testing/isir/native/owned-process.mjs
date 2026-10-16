import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const exited = child => child.exitCode !== null || child.signalCode !== null;
const waitForExit = (child, timeout) => new Promise(resolve => {
  if(exited(child))return resolve(true);
  const done=()=>{clearTimeout(timer);child.off('exit',done);resolve(exited(child));};
  const timer=setTimeout(done,timeout);child.once('exit',done);
});

// Read identity metadata only, never process command lines or environments.
// Both supported POSIX runners provide these ps columns.
function processTable() {
  const result=spawnSync('/bin/ps',['-axo','pid=,ppid=,pgid=,uid=,lstart=,stat='],{
    encoding:'utf8',timeout:1000,env:{...process.env,LC_ALL:'C'},
  });
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error('Could not verify owned native process identities');
  return result.stdout.trim().split('\n').map(line=>{
    const fields=line.trim().split(/\s+/);
    if(fields.length!==10||!fields.slice(0,4).every(value=>/^\d+$/.test(value)))throw new Error('Invalid process identity snapshot');
    return {pid:Number(fields[0]),parent:Number(fields[1]),group:Number(fields[2]),uid:Number(fields[3]),start:fields.slice(4,9).join(' '),running:!fields[9].startsWith('Z')};
  });
}
const sameIdentity = (a,b) => a.pid===b.pid&&a.group===b.group&&a.uid===b.uid&&a.start===b.start;

async function stopPosixGroup(child, timeout) {
  let table=processTable();
  const members=table.filter(row=>row.group===child.pid&&row.running);
  if(exited(child)) {
    // No live captured identity establishes ownership now. A numeric group ID
    // alone (potentially reused) must never authorize a late group signal.
    if(members.length)throw new Error('Exited native leader has unverified surviving group members');
    return;
  }
  const leader=members.find(row=>row.pid===child.pid);
  if(!leader||leader.parent!==process.pid||leader.uid!==process.getuid())throw new Error('Native detached child ownership could not be established');
  const owned=new Map(members.map(member=>[member.pid,member]));

  const inspect=()=>{
    table=processTable();
    const moved=table.some(row=>{
      const previous=owned.get(row.pid);
      return row.running&&previous&&previous.uid===row.uid&&previous.start===row.start&&previous.group!==row.group;
    });
    if(moved)throw new Error('Owned native member changed group during cleanup');
    const living=table.filter(row=>row.running&&owned.has(row.pid)&&sameIdentity(owned.get(row.pid),row));
    const group=table.filter(row=>row.running&&row.group===leader.group);
    const unknown=group.filter(row=>!owned.has(row.pid)||!sameIdentity(owned.get(row.pid),row));
    // A still-matching member anchors the original detached group. Capture
    // descendants born during graceful shutdown only while that proof remains.
    if(unknown.length&&!living.length)throw new Error('Native cleanup found unverified surviving group members');
    for(const member of unknown){owned.set(member.pid,member);living.push(member);}
    return living;
  };
  const signal=kind=>{
    for(const identity of inspect().sort((a,b)=>Number(a.pid===leader.pid)-Number(b.pid===leader.pid))) {
      // Re-read immediately before each individual PID signal. In particular,
      // leader exit never turns its old PGID into permission to kill a group.
      const current=processTable().find(row=>row.pid===identity.pid&&row.running);
      if(!current||!sameIdentity(identity,current))continue;
      try {process.kill(identity.pid,kind);}catch(error){if(error.code!=='ESRCH')throw error;}
    }
  };
  const waitForMembers=async()=>{
    const deadline=Date.now()+timeout;
    do {if(!inspect().length)return true;await delay(20);}while(Date.now()<deadline);
    return !inspect().length;
  };
  signal('SIGTERM');
  if(!await waitForMembers()) {
    signal('SIGKILL');
    if(!await waitForMembers())throw new Error('Owned native descendants did not exit');
  }
}

export async function stopNativeChild(child, timeout=3000) {
  if(!child.pid)return;
  if(process.platform==='win32') {
    if(exited(child))return;
    const result=spawnSync('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'});
    if(result.error)throw result.error;
  } else await stopPosixGroup(child,timeout);
  if(!await waitForExit(child,timeout))throw new Error('Owned native child did not exit');
  child.stdout?.destroy();child.stderr?.destroy();
}
