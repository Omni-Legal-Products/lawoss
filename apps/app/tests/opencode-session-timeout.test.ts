import { afterEach, expect, spyOn, test } from "bun:test";
import { createClient, unwrap } from "../src/app/lib/opencode";

const originalTimer = globalThis.setTimeout;
const originalClear = globalThis.clearTimeout;
let restore = () => {};
afterEach(() => restore());

/** Fetch start and transport deadlines advance only when the test says so. */
function controlledFetch() {
  const calls: Request[] = [];
  const deadlines: { ms: number; fire: () => void; cleared: boolean; handle: ReturnType<typeof setTimeout> }[] = [];
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Response>();
  const timer = spyOn(globalThis, "setTimeout").mockImplementation((handler, timeout, ...args) => {
    // Keep a correctly typed native handle, but never leave a live scheduled timer.
    const handle = originalTimer(() => {}, 2_147_483_647);
    originalClear(handle);
    deadlines.push({ ms: Number(timeout), fire: () => handler(...args), cleared: false, handle });
    return handle;
  });
  const clear = spyOn(globalThis, "clearTimeout").mockImplementation((handle) => {
    const deadline = deadlines.find(entry => entry.handle === handle);
    if (deadline) deadline.cleared = true;
  });
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    calls.push(request);
    request.signal.addEventListener("abort", () => response.reject(new DOMException("Aborted", "AbortError")), { once: true });
    started.resolve();
    return response.promise;
  });
  restore = () => { timer.mockRestore(); clear.mockRestore(); fetch.mockRestore(); };
  return { calls, deadlines, started: started.promise, respond: () => response.resolve(Response.json({ id: "session-created-once" })) };
}

test("session creation waits through cold engine startup and sends POST only once", async () => {
  const transport = controlledFetch();
  const client = createClient("http://localhost/workspace/ws_first/opencode", "/first-workspace", { mode: "legalwork", token: "fresh-token" });
  const pending = client.session.create({ directory: "/first-workspace" }).then(unwrap);
  await transport.started;
  expect(transport.deadlines.map(entry => entry.ms)).toEqual([60_000]);
  expect(transport.calls[0]?.signal.aborted).toBe(false);
  transport.respond();
  expect((await pending).id).toBe("session-created-once");
  expect(transport.deadlines[0]?.cleared).toBe(true);
  expect(transport.calls).toHaveLength(1);
  expect(transport.calls[0]?.method).toBe("POST");
  expect(transport.calls[0]?.url).toContain("/workspace/ws_first/opencode/session");
  expect(transport.calls[0]?.headers.get("Authorization")).toBe("Bearer fresh-token");
});

test("ordinary health reads retain their bounded short timeout", async () => {
  const transport = controlledFetch();
  const pending = createClient("http://localhost/opencode").global.health().then(unwrap);
  await transport.started;
  expect(transport.deadlines.map(entry => entry.ms)).toEqual([10_000]);
  transport.deadlines[0]!.fire();
  await expect(pending).rejects.toThrow(/timed out/i);
  expect(transport.calls).toHaveLength(1);
  expect(transport.calls[0]?.signal.aborted).toBe(true);
  expect(transport.deadlines[0]?.cleared).toBe(true);
});

test("session creation still times out without retrying when the engine never finishes", async () => {
  const transport = controlledFetch();
  const pending = createClient("http://localhost/opencode").session.create({}).then(unwrap);
  await transport.started;
  expect(transport.deadlines.map(entry => entry.ms)).toEqual([60_000]);
  transport.deadlines[0]!.fire();
  await expect(pending).rejects.toThrow(/timed out/i);
  expect(transport.calls).toHaveLength(1);
  expect(transport.calls[0]?.method).toBe("POST");
  expect(transport.calls[0]?.signal.aborted).toBe(true);
  expect(transport.deadlines[0]?.cleared).toBe(true);
});
