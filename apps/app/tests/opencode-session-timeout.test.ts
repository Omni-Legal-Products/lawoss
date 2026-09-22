import { afterEach, expect, spyOn, test } from "bun:test";
import { createClient, unwrap } from "../src/app/lib/opencode";

const originalTimer = globalThis.setTimeout;
const originalClear = globalThis.clearTimeout;
let restore = () => {};
afterEach(() => restore());

/** Scale transport deadlines, retaining a real asynchronous HTTP completion. */
function delayedFetch(delayMs: number) {
  const calls: Request[] = [];
  const timer = spyOn(globalThis, "setTimeout").mockImplementation((handler, timeout, ...args) =>
    originalTimer(handler, Number(timeout) / 1000, ...args));
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    calls.push(request);
    return new Promise<Response>((resolve, reject) => {
      const responseTimer = originalTimer(() => resolve(Response.json({ id: "session-created-once" })), delayMs);
      request.signal.addEventListener("abort", () => {
        originalClear(responseTimer);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
  });
  restore = () => { timer.mockRestore(); fetch.mockRestore(); };
  return calls;
}

test("session creation waits through cold engine startup and sends POST only once", async () => {
  const calls = delayedFetch(25); // Simulates a 25-second engine initialization.
  const client = createClient("http://localhost/workspace/ws_first/opencode", "/first-workspace", { mode: "legalwork", token: "fresh-token" });
  const result = unwrap(await client.session.create({ directory: "/first-workspace" }));
  expect(result.id).toBe("session-created-once");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.method).toBe("POST");
  expect(calls[0]?.url).toContain("/workspace/ws_first/opencode/session");
  expect(calls[0]?.headers.get("Authorization")).toBe("Bearer fresh-token");
});

test("ordinary health reads retain their bounded short timeout", async () => {
  const calls = delayedFetch(25);
  const client = createClient("http://localhost/opencode");
  await expect(client.global.health().then(unwrap)).rejects.toThrow(/timed out/i);
  expect(calls).toHaveLength(1);
});

test("session creation still times out without retrying when the engine never finishes", async () => {
  const calls = delayedFetch(200);
  const client = createClient("http://localhost/opencode");
  await expect(client.session.create({}).then(unwrap)).rejects.toThrow(/timed out/i);
  expect(calls).toHaveLength(1);
});
