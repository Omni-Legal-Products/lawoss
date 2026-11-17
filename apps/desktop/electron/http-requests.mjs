/** Buffered HTTP requests owned by a window, with cancellation and body deadlines. */
export function createHttpRequests(fetchImpl = fetch) {
  const owners = new Map();
  function cancel(owner, id) {
    owners.get(owner)?.get(id)?.abort();
  }
  return {
    cancel,
    async fetch(owner, url, init = {}) {
      if (owner.isDestroyed()) throw new Error("Window is closed.");
      if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error("HTTP URL required.");
      let requests = owners.get(owner);
      if (!requests) {
        requests = new Map();
        owners.set(owner, requests);
        owner.once("destroyed", () => {
          for (const controller of requests.values()) controller.abort();
          owners.delete(owner);
        });
      }
      const id = init.requestId ?? crypto.randomUUID();
      if (requests.has(id)) throw new Error("Request already exists.");
      const controller = new AbortController();
      requests.set(id, controller);
      const ms = Number(init.timeoutMs);
      let timedOut = false;
      const timer = Number.isFinite(ms) && ms > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, ms) : undefined;
      timer?.unref?.();
      try {
        const response = await fetchImpl(url, {
          method: typeof init.method === "string" ? init.method : undefined,
          headers: init.headers && typeof init.headers === "object" ? init.headers : undefined,
          body: typeof init.body === "string" ? init.body : undefined,
          signal: controller.signal,
        });
        const body = await response.text();
        controller.signal.throwIfAborted();
        return { status: response.status, statusText: response.statusText, headers: Array.from(response.headers.entries()), body };
      } catch (error) {
        // 🟡 LAWOSS #506: the window cancelled or closed and has settled the request
        // itself; a timeout says what expired, without the query string.
        if (timedOut) throw new Error(`Request timed out after ${ms} ms: ${typeof init.method === "string" ? init.method : "GET"} ${new URL(url).pathname}`, { cause: error });
        if (controller.signal.aborted) return null;
        throw error;
      } finally {
        clearTimeout(timer);
        requests.delete(id);
      }
    },
  };
}
