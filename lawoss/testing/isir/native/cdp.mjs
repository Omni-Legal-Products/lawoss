import { setTimeout } from "node:timers/promises";

export async function until(read, description, timeout = 30_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await read(); if (last) return last; } catch (e) { last = e; }
    await setTimeout(100);
  }
  throw new Error(`Timed out: ${description}; last=${String(last)}`);
}

export async function connectRenderer(url, request = fetch) {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" || parsed.protocol !== "http:" || !parsed.port) throw new Error("Explicit loopback CDP URL required");
  const target = await until(async () => {
    const targets = await (await request(`${url}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
    return targets.find(t => t.type === "page" && /^http:\/\/127\.0\.0\.1:/.test(t.url));
  }, "owned renderer CDP target");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  let next = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", event => {
    const value = JSON.parse(String(event.data));
    if (!value.id) { events.push(value); return; }
    const item = pending.get(value.id);
    if (!item) return;
    pending.delete(value.id); clearTimeout(item.timer);
    value.error ? item.reject(new Error(JSON.stringify(value.error))) : item.resolve(value.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = globalThis.setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 30_000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Runtime.enable");
  await send("Network.enable");
  // Only this fixture-owned page: background CI windows must still exercise
  // the production foreground-only query polling, including after reload.
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  return {
    send, events,
    async evaluate(expression) {
      const value = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (value.exceptionDetails) throw new Error(value.exceptionDetails.text + ": " + value.exceptionDetails.exception?.description);
      return value.result?.value;
    },
    close() { ws.close(); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("CDP closed")); } pending.clear(); },
  };
}
