import { settleCleanup } from './diagnostics.mjs';

const exited = child => child.exitCode !== null || child.signalCode !== null;

// One additional user-style quit window, not a reset of any strict stop phase.
// POSIX acknowledgement/leader exit are observations; owned stop still gates movement.
async function requestOrdinaryQuit({requestQuit,child,setTimer,clearTimer}) {
  let timer,onExit;
  const exit=new Promise(resolve=>{
    onExit=resolve;
    child.once('exit',onExit);
    if(exited(child))resolve();
  });
  const deadline=new Promise(resolve=>{timer=setTimer(resolve,3000);});
  try {
    await Promise.race([Promise.resolve().then(requestQuit).then(()=>exit),deadline]);
  } finally {
    clearTimer(timer);
    child.off('exit',onExit);
  }
}

// The native driver's relaunch boundary. POSIX stop verifies group closure;
// Windows retains its preexisting stop contract without inducing leader exit.
export async function stopForRelaunch({requestQuit,closeCdp,child,stop,cleanupFailures=[],platform=process.platform,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let primary;
  // Windows must not induce the exited-leader early return in its existing
  // stop contract. Skip only quit; both platforms retain independent cleanup.
  if(platform!=='win32') {
    try {await requestOrdinaryQuit({requestQuit,child,setTimer,clearTimer});}
    catch(error){primary=error;}
  }
  const result=await settleCleanup(primary,[closeCdp,()=>stop(child)]);
  cleanupFailures.push(...result.failures);
  // Keep the exact first error and separately retain every ordered cleanup
  // failure; no aggregate wrapper may hide the original refusal/request error.
  if(primary)throw primary;
  if(result.failures.length)throw result.failures[0];
}
