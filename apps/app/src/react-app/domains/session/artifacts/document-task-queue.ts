/** Reads and writes on one live draft must finish in order, including saving.
 * Other documents can run independently. A failed call never poisons the queue. */
export function createDocumentTaskQueue() {
  const pending = new Map<string, Promise<unknown>>();
  return <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const result = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
    pending.set(key, result);
    void result.finally(() => { if (pending.get(key) === result) pending.delete(key); }).catch(() => {});
    return result;
  };
}
