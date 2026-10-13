import { spawnOwnedChild } from "./owned-child-process.js";

// Pre owned-child-process.test.ts: zastupuje proces testov, ktorý spustí engine
// a zomrie bez afterAll. Vypíše pid potomka a čaká, kým ho test nezabije.
const child = spawnOwnedChild(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"]);
console.log(child.pid);
setInterval(() => {}, 1000);
