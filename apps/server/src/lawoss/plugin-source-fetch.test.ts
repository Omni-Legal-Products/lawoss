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
    expect(response).toBe(ok);
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
});
