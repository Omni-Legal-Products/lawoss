import { spawnSync } from 'node:child_process';
const exited = child => child.exitCode !== null || child.signalCode !== null;
const waitForExit = (child, timeout) => new Promise(resolve => {
  if(exited(child))return resolve(true);
  const done=()=>{clearTimeout(timer);child.off('exit',done);resolve(exited(child));};
  const timer=setTimeout(done,timeout);child.once('exit',done);
});
const signalOwnedGroup = (child, signal) => {
  // Only a still-live ChildProcess launched detached by this harness owns this
  // group. Never send a late signal after its PID may have been reused.
  if(exited(child))return;
  try {process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}
};
export async function stopNativeChild(child, timeout=3000) {
  if(!child.pid||exited(child))return;
  if(process.platform==='win32') {
    const result=spawnSync('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'});
    if(result.error)throw result.error;
  } else {
    signalOwnedGroup(child,'SIGTERM');
    if(!await waitForExit(child,timeout))signalOwnedGroup(child,'SIGKILL');
  }
  if(!await waitForExit(child,timeout))throw new Error('Owned native child did not exit');
  child.stdout?.destroy();child.stderr?.destroy();
}
