import { expect, test } from "bun:test";
import { isLocalModelEndpoint, LOCAL_PROVIDER_TIMEOUT_MS, localProviderTimeouts } from "../src/lawoss/providers/local-timeouts";

test("lokálne modely dostanú dlhší limit, cloud ostane na predvolených hodnotách (D1 2026-10-05)", () => {
  for (const url of ["http://localhost:11434/v1", "http://127.0.0.1:1234/v1", "http://[::1]:8080/v1", "http://studio.local:1234/v1", " http://LOCALHOST:11434/v1 "]) {
    expect({ url, local: isLocalModelEndpoint(url) }).toEqual({ url, local: true });
    expect(localProviderTimeouts(url)).toEqual({ headerTimeout: LOCAL_PROVIDER_TIMEOUT_MS, chunkTimeout: LOCAL_PROVIDER_TIMEOUT_MS });
  }
  for (const url of ["https://api.openai.com/v1", "https://openrouter.ai/api/v1", "http://localhost.evil.com/v1", "nie-url", ""]) {
    expect({ url, local: isLocalModelEndpoint(url) }).toEqual({ url, local: false });
    expect(localProviderTimeouts(url)).toEqual({});
  }
  expect(LOCAL_PROVIDER_TIMEOUT_MS).toBe(30 * 60_000);
});
