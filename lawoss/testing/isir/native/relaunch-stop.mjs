import { settleCleanup } from './diagnostics.mjs';
import { isNativeShutdownNavigation } from './cdp.mjs';

const exited = child => child.exitCode !== null || child.signalCode !== null;

// One additional user-style quit window, not a reset of any strict stop phase.
// POSIX acknowledgement/leader exit are observations; owned stop still gates movement.
async function requestOrdinaryQuit({requestQuit,readQuitAcceptance,cleanupFailures,child,setTimer,clearTimer}) {
  let timer,onExit,active=true;
  const exit=new Promise(resolve=>{
    onExit=resolve;
    child.once('exit',onExit);
    if(exited(child))resolve();
  });
  const deadline=new Promise(resolve=>{timer=setTimer(resolve,3000);});
  try {
    const accepted=Promise.resolve().then(requestQuit).then(()=>{
      if (!active) return;
      if (readQuitAcceptance && readQuitAcceptance() !== true) throw Object.assign(new Error('Native quit acceptance missing'),{code:'ISIR_NATIVE_QUIT_UNACCEPTED'});
    },error=>{
      if (!active || !readQuitAcceptance || !isNativeShutdownNavigation(error)) throw error;
      let accepted;
      try { accepted=readQuitAcceptance(); }
      catch(readError) { cleanupFailures.push(readError); throw error; }
      if (accepted !== true) throw error;
    });
    let requestSettled=false;
    const completed=accepted.then(()=>{requestSettled=true;return exit;});
    await Promise.race([completed,deadline]);
    if (readQuitAcceptance && !requestSettled) throw Object.assign(new Error('Native quit request unacknowledged within original window'),{code:'ISIR_NATIVE_QUIT_UNACKNOWLEDGED'});
  } finally {
    active=false;
    clearTimer(timer);
    child.off('exit',onExit);
  }
}

// The native driver's relaunch boundary. POSIX stop verifies group closure;
// Windows retains its preexisting stop contract without inducing leader exit.
export async function stopForRelaunch({requestQuit,readQuitAcceptance,closeCdp,child,stop,cleanupFailures=[],platform=process.platform,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let primary;
  // Windows must not induce the exited-leader early return in its existing
  // stop contract. Skip only quit; both platforms retain independent cleanup.
  if(platform!=='win32') {
    try {await requestOrdinaryQuit({requestQuit,readQuitAcceptance,cleanupFailures,child,setTimer,clearTimer});}
    catch(error){primary=error;}
  }
  const result=await settleCleanup(primary,[closeCdp,()=>stop(child)]);
  cleanupFailures.push(...result.failures);
  // Keep the exact first error and separately retain every ordered cleanup
  // failure; no aggregate wrapper may hide the original refusal/request error.
  if(primary)throw primary;
  if(result.failures.length)throw result.failures[0];
}
