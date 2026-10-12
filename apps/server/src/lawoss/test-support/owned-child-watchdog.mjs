// Strážca procesu, ktorý spustil test cez spawnOwnedChild (owned-child-process.ts).
//
// Beží v samostatnej skupine procesov, takže ho nezasiahne signál pre skupinu
// testov. Keď proces testov skončí bez upratania (SIGKILL, SIGTERM, timeout
// nástroja), strážca ukončí celú skupinu potomka a sám skončí. Skončí aj vtedy,
// keď skupina potomka zanikne sama.
//
// Argumenty: <pid procesu testov> <pid potomka, zároveň id jeho skupiny>

const POLL_MS = 200;
const GRACE_MS = 2000;

const [parentPid, childPid] = process.argv.slice(2).map(Number);
if (!Number.isInteger(parentPid) || !Number.isInteger(childPid) || childPid <= 0) process.exit(2);

function exists(target) {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function signalGroup(signal) {
  try {
    process.kill(-childPid, signal);
  } catch {
    // Skupina medzitým zanikla.
  }
}

// Po smrti rodiča sa strážca presunie pod launchd/init a zmení sa mu ppid.
const parentGone = () => process.ppid !== parentPid || !exists(parentPid);

const timer = setInterval(() => {
  if (!exists(-childPid)) process.exit(0);
  if (!parentGone()) return;
  clearInterval(timer);
  signalGroup("SIGTERM");
  setTimeout(() => {
    signalGroup("SIGKILL");
    process.exit(0);
  }, GRACE_MS);
}, POLL_MS);
