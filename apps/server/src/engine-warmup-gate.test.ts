import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abortable, cachedEngineResponse, sharedEngineResponse } from "./engine-warmup-gate.js";

test("zrušený volajúci pozoruje neskoré zlyhanie aj pri zrušení pred vytvorením obalu", async () => {
  const directory = await mkdtemp(join(tmpdir(), "warmup-preabort-rejection-"));
  const script = join(directory, "late-rejection.ts");
  try {
    await Bun.write(script, `
      import { abortable } from ${JSON.stringify(new URL("./engine-warmup-gate.ts", import.meta.url).href)};
      const caller = new AbortController();
      const reason = new Error("CALLER_CANCELLED");
      let rejectShared;
      const shared = new Promise((_, reject) => { rejectShared = reject; });
      if (process.argv[2] === "before") caller.abort(reason);
      const wrapped = abortable(shared, caller.signal);
      if (process.argv[2] === "after") caller.abort(reason);
      await wrapped.then(
        () => { throw new Error("unexpected caller success"); },
        (error) => { if (error !== reason) throw new Error("caller reason identity changed"); },
      );
      console.log("caller-reason-identity: true");
      rejectShared(new Error("SHARED_LATE_REJECTION"));
      await Promise.resolve();
      console.log("shared-rejected-after-cancellation");
    `);
    for (const mode of ["before", "after"]) {
      const child = Bun.spawn([process.execPath, script, mode], {
        cwd: directory,
        env: { TMPDIR: directory, TEMP: directory, TMP: directory },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect({ mode, exit, stderr }).toEqual({ mode, exit: 0, stderr: "" });
      expect(stdout).toBe("caller-reason-identity: true\nshared-rejected-after-cancellation\n");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const outcome of ["resolve", "reject"] as const) test(`predčasné zrušenie nezmení zdieľanú prácu ani jej výsledok: ${outcome}`, async () => {
  let resolveStart!: (response: Response) => void;
  let rejectStart!: (error: Error) => void;
  const started = new Promise<Response>((resolve, reject) => {
    resolveStart = resolve;
    rejectStart = reject;
  });
  let entered!: () => void;
  const admitted = new Promise<void>((resolve) => { entered = resolve; });
  let upstream!: AbortSignal;
  const shared = sharedEngineResponse(`http://127.0.0.1:9/preaborted-${outcome}`, (signal) => {
    upstream = signal;
    entered();
    return started;
  }, 1_000, {});
  const caller = new AbortController();
  const reason = new Error("caller cancelled before admission");
  caller.abort(reason);
  try {
    await expect(abortable(shared, caller.signal)).rejects.toBe(reason);
    await admitted;
    expect(upstream.aborted).toBe(false);
    const active = abortable(shared, new AbortController().signal);
    if (outcome === "reject") {
      const failure = new Error("original shared failure");
      rejectStart(failure);
      await expect(active).rejects.toBe(failure);
      await expect(shared).rejects.toBe(failure);
    } else {
      resolveStart(new Response("ready"));
      const cached = await active;
      expect(cached).toBe(await shared);
      expect(await cachedEngineResponse(cached).text()).toBe("ready");
    }
    expect(upstream.aborted).toBe(false);
  } finally {
    resolveStart(new Response("cleanup"));
    await shared.catch(() => {});
  }
});

test("bez signálu vracia pôvodný Promise", async () => {
  const value = {};
  const shared = Promise.resolve(value);
  expect(abortable(shared)).toBe(shared);
  expect(abortable(shared, null)).toBe(shared);
  expect(await shared).toBe(value);
});

test("súbežné GET /mcp zdieľajú jeden štart a prerušenie volajúceho ho nezruší", async () => {
  let calls = 0;
  let upstream: AbortSignal | undefined;
  let release: (response: Response) => void = () => {};
  const started = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const start = (signal: AbortSignal) => {
    calls += 1;
    upstream = signal;
    return started;
  };
  const caller = new AbortController();
  const first = abortable(sharedEngineResponse("http://127.0.0.1:9/mcp?directory=a", start), caller.signal);
  const second = sharedEngineResponse("http://127.0.0.1:9/mcp?directory=a", start);
  await Promise.resolve();
  expect(calls).toBe(1);
  caller.abort();
  await expect(first).rejects.toMatchObject({ name: "AbortError" });
  expect(upstream?.aborted).toBe(false);
  release(new Response(JSON.stringify({ ready: true }), { status: 200, headers: { "content-type": "application/json" } }));
  const cached = await second;
  expect(cached.status).toBe(200);
  expect(await cachedEngineResponse(cached).json()).toEqual({ ready: true });
  let again = 0;
  await sharedEngineResponse("http://127.0.0.1:9/mcp?directory=a", () => {
    again += 1;
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  expect(again).toBe(1);
});

test("zlyhaný štart sa nezapamätá", async () => {
  let calls = 0;
  const start = () => {
    calls += 1;
    return Promise.reject(new Error("engine down"));
  };
  const key = "http://127.0.0.1:9/mcp?directory=b";
  await expect(sharedEngineResponse(key, start)).rejects.toThrow("engine down");
  await expect(sharedEngineResponse(key, start)).rejects.toThrow("engine down");
  expect(calls).toBe(2);
});

test("iný directory počká, kým dobehne rozbehnutý štart, a dostane vlastnú odpoveď", async () => {
  let release: (response: Response) => void = () => {};
  const hold = new Promise<Response>((resolve) => { release = resolve; });
  let calls = 0;
  const start = () => {
    calls += 1;
    return calls === 1 ? hold : Promise.resolve(new Response("{\"n\":2}", { status: 201, headers: { "content-type": "application/json" } }));
  };
  const first = sharedEngineResponse("http://127.0.0.1:9/mcp?directory=one", start, 1_000);
  const second = sharedEngineResponse("http://127.0.0.1:9/mcp?directory=two", start, 1_000);
  for (let i = 0; i < 5 && calls === 0; i += 1) await Promise.resolve();
  expect(calls).toBe(1);
  release(new Response("{\"n\":1}", { status: 200, headers: { "content-type": "application/json" } }));
  const [a, b] = await Promise.all([first, second]);
  expect(a.status).toBe(200);
  expect(await cachedEngineResponse(a).json()).toEqual({ n: 1 });
  expect(b.status).toBe(201);
  expect(await cachedEngineResponse(b).json()).toEqual({ n: 2 });
  expect(calls).toBe(2);
});

test("zlyhaný štart uvoľní rad a iný directory sa spustí", async () => {
  const order: string[] = [];
  const first = sharedEngineResponse("http://127.0.0.1:9/mcp?directory=fail", () => {
    order.push("fail");
    return Promise.reject(new Error("install failed"));
  });
  const second = sharedEngineResponse("http://127.0.0.1:9/mcp?directory=next", () => {
    order.push("next");
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  await expect(first).rejects.toThrow("install failed");
  expect((await second).status).toBe(200);
  expect(order).toEqual(["fail", "next"]);
});

for (const status of [204, 205, 304]) test(`shared metadata preserves bodyless HTTP ${status}`, async () => {
  const cached = await sharedEngineResponse(`http://127.0.0.1:9/empty-${status}`, () =>
    Promise.resolve(new Response(null, { status })));
  const response = cachedEngineResponse(cached);
  expect(response.status).toBe(status);
  expect(response.body).toBeNull();
  expect(await response.text()).toBe("");
});

test("matching engine credentials cannot share another host owner's readiness response", async () => {
  const key = "http://127.0.0.1:9/mcp?directory=shared";
  const first = sharedEngineResponse(key, async () => Response.json({ owner: "first" }), 1_000, {});
  const second = sharedEngineResponse(key, async () => Response.json({ owner: "second" }), 1_000, {});
  expect(await cachedEngineResponse(await first).json()).toEqual({ owner: "first" });
  expect(await cachedEngineResponse(await second).json()).toEqual({ owner: "second" });
});
