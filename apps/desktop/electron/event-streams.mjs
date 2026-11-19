// Event streams use Node's transport so full app windows do not exhaust
// Chromium's shared HTTP/1 connection pool. Each read pulls just one chunk.
export function createEventStreams(fetchImpl = fetch) {
  const owners = new Map();
  // 🟡 LAWOSS #561: once the app quits, main ends every stream before the embedded
  // server closes their sockets; a socket closed while the app runs still rejects.
  let closed = false;

  function cancel(owner, id) {
    const streams = owners.get(owner);
    const stream = streams?.get(id);
    if (!stream) return;
    streams.delete(id);
    stream.controller.abort();
  }

  return {
    async open(owner, id, url, headers) {
      if (owner.isDestroyed()) throw new Error("Window is closed.");
      if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error("HTTP URL required.");
      if (closed) return null;
      let streams = owners.get(owner);
      if (!streams) {
        streams = new Map();
        owners.set(owner, streams);
        owner.once("destroyed", () => {
          for (const stream of streams.values()) stream.controller.abort();
          owners.delete(owner);
        });
      }
      if (streams.has(id)) throw new Error("Stream already exists.");
      const stream = { controller: new AbortController(), reader: null };
      streams.set(id, stream);
      try {
        const response = await fetchImpl(url, { headers, signal: stream.controller.signal });
        stream.controller.signal.throwIfAborted();
        stream.reader = response.body?.getReader();
        return { status: response.status, statusText: response.statusText, headers: Array.from(response.headers.entries()) };
      } catch (error) {
        const cancelled = stream.controller.signal.aborted;
        cancel(owner, id);
        // 🟡 LAWOSS #506: like read(), a window that cancelled or closed has settled
        // this stream itself; rejecting would only log an IPC handler error.
        if (cancelled) return null;
        throw error;
      }
    },
    async read(owner, id) {
      const stream = owners.get(owner)?.get(id);
      if (!stream && closed) return null;
      if (!stream) throw new Error("Stream is closed or belongs to another window.");
      try {
        const chunk = stream.reader ? await stream.reader.read() : { done: true };
        if (chunk.done) {
          cancel(owner, id);
          return null;
        }
        return chunk.value;
      } catch (error) {
        const cancelled = stream.controller.signal.aborted;
        cancel(owner, id);
        // Window closure and renderer cancellation are normal end-of-stream.
        if (cancelled) return null;
        throw error;
      }
    },
    cancel,
    closeAll() {
      closed = true;
      for (const [owner, streams] of owners) for (const id of [...streams.keys()]) cancel(owner, id);
    },
  };
}
