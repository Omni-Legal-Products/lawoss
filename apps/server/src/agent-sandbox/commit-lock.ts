import { within } from "./files.js";

const pending = new Set<{ paths: string[]; done: Promise<void> }>();

/** Hold all destinations together, including ancestor/descendant conflicts.
 * Unchanged filesystems and disjoint publications never wait for each other. */
export async function withCommitPaths(paths: string[], signal: AbortSignal, publish: () => Promise<void>): Promise<void> {
  signal.throwIfAborted();
  if (!paths.length) return;
  const blockers = [...pending].filter(job => paths.some(path => job.paths.some(other => within(path, other) || within(other, path))));
  let release = () => {};
  const job = { paths, done: new Promise<void>(resolve => { release = resolve; }) };
  pending.add(job);
  let abort = () => {};
  try {
    await Promise.race([
      Promise.all(blockers.map(job => job.done)),
      new Promise<never>((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener("abort", abort, { once: true }); }),
    ]);
    signal.throwIfAborted();
    await publish();
  } finally {
    signal.removeEventListener("abort", abort);
    pending.delete(job);
    release();
  }
}
