import { describe, expect, test } from "bun:test";
import { ApiError } from "../errors.js";
import { fetchPluginSource } from "./plugin-source-fetch.js";

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
});
