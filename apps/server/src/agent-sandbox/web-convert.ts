import { Worker } from "node:worker_threads";
import { WEB_WORKER_CODE } from "./web-worker-code.js";

const active = new Set<Promise<void>>();
/** Untrusted HTML never runs on the server thread. Bound both input complexity
 * and concurrency; a deadline or revocation terminates parsing before return. */
export async function convertHtml(content: string, format: "text" | "markdown", parent: AbortSignal, timeoutMs = 5000): Promise<string> {
  parent.throwIfAborted();
  if (Buffer.byteLength(content) > 4 * 1024 * 1024) throw new Error("This page is too large to convert. Request its HTML instead.");
  let tags = 0;
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 60 && ++tags > 20000) throw new Error("This page is too complex to convert. Request its HTML instead.");
  }
  const timeout = new AbortController();
  const signal = AbortSignal.any([parent, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(new Error("Website conversion timed out.")), timeoutMs);
  let wake = () => {};
  const aborted = new Promise<never>((_, reject) => {
    wake = () => reject(signal.reason);
    signal.addEventListener("abort", wake, { once: true });
  });
  // The catch also handles an abort between worker creation and listener setup.
  void aborted.catch(() => {});
  let worker: Worker | undefined;
  let done = () => {};
  const slot = new Promise<void>(resolve => { done = resolve; });
  try {
    while (active.size >= 2) await Promise.race([...active, aborted]);
    signal.throwIfAborted();
    active.add(slot);
    worker = new Worker(WEB_WORKER_CODE, { eval: true, execArgv: [], workerData: { content, format },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 } });
    return await Promise.race([aborted, new Promise<string>((resolve, reject) => {
      worker!.once("message", value => typeof value === "string" ? resolve(value) : reject(new Error("Website conversion failed.")));
      worker!.once("error", reject);
      worker!.once("exit", () => reject(new Error("Website conversion stopped.")));
    })]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", wake);
    await worker?.terminate();
    active.delete(slot); done();
  }
}
