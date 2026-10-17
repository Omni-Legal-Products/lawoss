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
function processTable(group, capturedPids) {
  // Darwin ps(1) selects the union of -g and -p; -x includes detached members.
  // Keep every captured PID to detect moves/reuse. The living caller is only a
  // nonempty-query sentinel, never an owned member or permission to signal.
  if(process.platform==='darwin'&&(!Number.isInteger(group)||group<=0||[...capturedPids].some(pid=>!Number.isInteger(pid)||pid<=0)))throw new Error('Invalid owned native process selection');
  const args=process.platform==='darwin'
    ? ['-x','-g',String(group),'-p',[process.pid,...capturedPids].join(','),'-o','pid=,ppid=,pgid=,uid=,lstart=,stat=']
    : ['-axo','pid=,ppid=,pgid=,uid=,lstart=,stat='];
  const result=spawnSync('/bin/ps',args,{
    encoding:'utf8',timeout:1000,env:{...process.env,LC_ALL:'C',...(process.platform==='darwin'?{COMMAND_MODE:'unix2003'}:{})},
  });
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error('Could not verify owned native process identities');
  const rows=result.stdout.trim().split('\n').map(line=>{
    const fields=line.trim().split(/\s+/);
    if(fields.length!==10||!fields.slice(0,4).every(value=>/^\d+$/.test(value)))throw new Error('Invalid process identity snapshot');
    return {pid:Number(fields[0]),parent:Number(fields[1]),group:Number(fields[2]),uid:Number(fields[3]),start:fields.slice(4,9).join(' '),running:!fields[9].startsWith('Z')};
  });
  return process.platform==='darwin'?rows.filter(row=>row.pid!==process.pid):rows;
}
const sameIdentity = (a,b) => a.pid===b.pid&&a.group===b.group&&a.uid===b.uid&&a.start===b.start;

async function stopPosixGroup(child, timeout, {readTable,kill=(pid,kind)=>process.kill(pid,kind),observe=()=>{},now=()=>performance.now()}) {
  const started=performance.now();let index=1,ownershipEstablished=false;
  const capturedPids=new Set([child.pid]);
  const snapshot=()=>readTable
    ? readTable({group:child.pid,pids:[...capturedPids],sentinelPid:process.pid})
    : processTable(child.pid,capturedPids);
  const table=snapshot();
  const members=table.filter(row=>row.group===child.pid&&row.running);
  const owned=new Map(members.map(member=>[member.pid,member]));
  for(const member of members)capturedPids.add(member.pid);
  const census=(stage,rows)=>{
    const matching=row=>owned.has(row.pid)&&sameIdentity(owned.get(row.pid),row);
    const knownLive=rows.filter(row=>row.running&&matching(row)).length;
    observe({stage,index:index++,elapsedMs:Math.round(performance.now()-started),knownLive,
      unknown:rows.filter(row=>row.running&&row.group===child.pid&&!matching(row)).length,
      moved:rows.filter(row=>{const old=owned.get(row.pid);return row.running&&old&&old.uid===row.uid&&old.start===row.start&&old.group!==row.group}).length,
      mismatched:rows.filter(row=>row.running&&owned.has(row.pid)&&!matching(row)).length,
      leaderExited:exited(child),anchored:ownershipEstablished&&knownLive>0});
  };
  census('capture',table);
  if(exited(child)) {
    // No live captured identity establishes ownership now. A numeric group ID
    // alone (potentially reused) must never authorize a late group signal.
    if(members.length)throw new Error('Exited native leader has unverified surviving group members');
    return;
  }
  const leader=members.find(row=>row.pid===child.pid);
  if(!leader||leader.parent!==process.pid||leader.uid!==process.getuid())throw new Error('Native detached child ownership could not be established');
  ownershipEstablished=true;
  const admit=(stage,table)=>{
    census(stage,table);
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
    for(const member of unknown){owned.set(member.pid,member);capturedPids.add(member.pid);living.push(member);}
    return living;
  };
  const inspect=stage=>admit(stage,snapshot());
  const phase=async(kind,signalStage,waitStage)=>{
    // Discovery, every signal recheck, and waiting share this phase's original
    // budget. A stream of newly anchored members cannot restart the timeout.
    const deadline=now()+timeout,attempted=new Set(),replacements=new Set();
    const key=row=>JSON.stringify([row.pid,row.group,row.uid,row.start]);
    const signal=members=>{
      let living=members;
      while(now()<deadline) {
        const identity=living.filter(row=>!attempted.has(key(row)))
          .sort((a,b)=>Number(replacements.has(key(a)))-Number(replacements.has(key(b)))||Number(a.pid===leader.pid)-Number(b.pid===leader.pid))[0];
        if(!identity)return;
        attempted.add(key(identity));
        // Re-read immediately before each individual PID signal. In particular,
        // leader exit never turns its old PGID into permission to kill a group.
        const fresh=snapshot();living=admit('signal-recheck',fresh);
        if(now()>=deadline)return;
        const current=fresh.find(row=>row.pid===identity.pid&&row.running);
        if(!current||!sameIdentity(identity,current)) {
          // Keep already queued identities ahead of a changed PID's new birth;
          // its admission cannot borrow the stale candidate's signal attempt.
          if(current)replacements.add(key(current));
          continue;
        }
        try {kill(identity.pid,kind);}catch(error){if(error.code!=='ESRCH')throw error;}
      }
    };
    signal(inspect(signalStage));
    if(now()>=deadline)return false;
    do {
      const living=inspect(waitStage);
      if(!living.length)return true;
      // Graceful-wait discoveries retain the existing force-escalation policy.
      // Force-wait discoveries need their own fresh, individual signal too.
      if(kind==='SIGKILL')signal(living);
      if(now()>=deadline)break;
      await delay(Math.min(20,deadline-now()));
    }while(now()<deadline);
    return !inspect(waitStage).length;
  };
  if(!await phase('SIGTERM','term-signal','term-wait')) {
    if(!await phase('SIGKILL','kill-signal','kill-wait'))throw new Error('Owned native descendants did not exit');
  }
}

export async function stopNativeChild(child, timeout=3000, inspection={}) {
  if(!child.pid)return;
  if(process.platform==='win32') {
    if(exited(child))return;
    const result=spawnSync('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'});
    if(result.error)throw result.error;
  } else await stopPosixGroup(child,timeout,inspection);
  if(!await waitForExit(child,timeout))throw new Error('Owned native child did not exit');
  child.stdout?.destroy();child.stderr?.destroy();
}
