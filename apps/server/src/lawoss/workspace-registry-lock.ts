import type { ServerConfig } from "../types.js";
const queues = new WeakMap<ServerConfig, Promise<unknown>>();
/** Registry writes and their disk persistence form one serialized operation. */
export function serializeWorkspaceMutation<T>(config: ServerConfig, operation: () => Promise<T>): Promise<T> {
  const next = (queues.get(config) ?? Promise.resolve()).catch(() => undefined).then(operation);
  queues.set(config, next);
  return next;
}
