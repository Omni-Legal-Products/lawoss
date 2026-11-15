import { describe, expect, test } from "bun:test";
import { ApiError } from "../errors.js";
import { fetchPluginSource, PluginSourceTooLargeError } from "./plugin-source-fetch.js";

const ok = new Response("ok");

describe("fetchPluginSource", () => {
  test("prechodný výpadok siete jedno opakovanie prekoná", async () => {
    let calls = 0;
    const response = await fetchPluginSource("https://example.test/a", {}, {
      retryDelayMs: 0,
      fetch: (async () => { calls += 1; if (calls === 1) throw new TypeError("fetch failed"); return ok; }) as unknown as typeof fetch,
    });
    expect(await response.text()).toBe("ok");
    expect(calls).toBe(2);
  });

  test("trvalý výpadok vráti vlastný kód, nie všeobecnú chybu servera", async () => {
    let calls = 0;
    const failure = await fetchPluginSource("https://example.test/a", {}, {
      retryDelayMs: 0,
      fetch: (async () => { calls += 1; throw new TypeError("fetch failed"); }) as unknown as typeof fetch,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("plugin_source_unreachable");
    expect(calls).toBe(2);
  });

  test("odpoveď s chybovým stavom sa neopakuje, rieši ju volajúci", async () => {
    let calls = 0;
    const response = await fetchPluginSource("https://example.test/a", {}, {
      retryDelayMs: 0,
      fetch: (async () => { calls += 1; return new Response("nie", { status: 404 }); }) as unknown as typeof fetch,
    });
    expect(response.status).toBe(404);
    expect(calls).toBe(1);
  });

  // #420: pomalé, ale plynulé telo (pribalený runtime) sa stiahne celé; zaseknuté telo sa zopakuje a potom vráti vlastný kód.
  test("limit platí na nečinnosť tela, nie na celé sťahovanie", async () => {
    const trickle = (pieces: number, delayMs: number) => Bun.serve({
      port: 0,
      fetch() {
        let sent = 0;
        return new Response(new ReadableStream({
          async pull(controller) {
            await Bun.sleep(delayMs);
            controller.enqueue(new TextEncoder().encode("x".repeat(1000)));
            if (++sent >= pieces) controller.close();
          },
        }));
      },
    });
    const slow = trickle(10, 50);
    try {
      const response = await fetchPluginSource(`http://127.0.0.1:${slow.port}/`, {}, { idleTimeoutMs: 200, retryIdleTimeoutMs: 200, retryDelayMs: 0 });
      expect((await response.text()).length).toBe(10_000);
    } finally {
      await slow.stop(true);
    }
    const stalled = trickle(2, 400);
    try {
      const failure = await fetchPluginSource(`http://127.0.0.1:${stalled.port}/`, {}, { idleTimeoutMs: 200, retryIdleTimeoutMs: 200, retryDelayMs: 0 }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).code).toBe("plugin_source_unreachable");
    } finally {
      await stalled.stop(true);
    }
  });

  // #420: strop bajtov a celkový čas platia počas sťahovania, nie až po načítaní celého tela.
  test("nekonečné telo sa preruší hneď po prekročení stropu, spojenie sa zavrie a neopakuje sa", async () => {
    let requests = 0;
    let pulls = 0;
    let cancelled = false;
    const endless = Bun.serve({
      port: 0,
      fetch() {
        requests += 1;
        return new Response(new ReadableStream({
          pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(64 * 1024)); },
          cancel() { cancelled = true; },
        }));
      },
    });
    try {
      const failure = await fetchPluginSource(`http://127.0.0.1:${endless.port}/`, {}, { maxBytes: 1024 * 1024, retryDelayMs: 0 }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(PluginSourceTooLargeError);
      expect(requests).toBe(1);
      for (let wait = 0; wait < 50 && !cancelled; wait += 1) await Bun.sleep(20);
      expect(cancelled).toBe(true);
      const settled = pulls;
      await Bun.sleep(100);
      expect(pulls).toBe(settled);
    } finally {
      await endless.stop(true);
    }
  });

  test("Content-Length nad stropom sa odmietne bez čítania tela", async () => {
    let calls = 0;
    let pulls = 0;
    const failure = await fetchPluginSource("https://example.test/a", {}, {
      maxBytes: 1024,
      retryDelayMs: 0,
      fetch: (async () => {
        calls += 1;
        const body = new ReadableStream({ pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(1024)); } }, { highWaterMark: 0 });
        return new Response(body, { headers: { "content-length": String(64 * 1024 * 1024) } });
      }) as unknown as typeof fetch,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PluginSourceTooLargeError);
    expect(calls).toBe(1);
    expect(pulls).toBe(0);
  });

  test("telo, ktoré kvapká tesne pod limitom nečinnosti, ukončí celkový strop bez ďalšieho pokusu", async () => {
    let requests = 0;
    const trickle = Bun.serve({
      port: 0,
      fetch() {
        requests += 1;
        return new Response(new ReadableStream({
          async pull(controller) { await Bun.sleep(40); controller.enqueue(new Uint8Array(1)); },
        }));
      },
    });
    try {
      const started = Date.now();
      const failure = await fetchPluginSource(`http://127.0.0.1:${trickle.port}/`, {}, { idleTimeoutMs: 200, retryIdleTimeoutMs: 200, deadlineMs: 400, retryDelayMs: 0 }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).code).toBe("plugin_source_unreachable");
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(requests).toBe(1);
    } finally {
      await trickle.stop(true);
    }
  });

  test("zrušenie zvonka sa neopakuje", async () => {
    let calls = 0;
    const controller = new AbortController();
    const reason = new Error("sibling failed");
    const failure = await fetchPluginSource("https://example.test/a", {}, {
      signal: controller.signal,
      retryDelayMs: 0,
      fetch: ((_url: string, init?: RequestInit) => {
        calls += 1;
        controller.abort(reason);
        return Promise.reject(init?.signal?.reason);
      }) as unknown as typeof fetch,
    }).catch((error: unknown) => error);
    expect(failure).toBe(reason);
    expect(calls).toBe(1);
  });
});
