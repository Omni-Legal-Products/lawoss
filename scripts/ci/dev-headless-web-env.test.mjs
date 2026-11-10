import assert from "node:assert/strict";
import { test } from "node:test";
import { headlessWebViteEnv, isLoopbackClientUrl } from "../dev-headless-web-env.mjs";

const input = {
  env: {},
  viteHost: "0.0.0.0",
  webPort: 5173,
  legalworkPort: 8787,
  legalworkToken: "client-token",
  legalworkHostToken: "host-token",
};

test("loopback client receives the host token used by the server", () => {
  const env = headlessWebViteEnv({ ...input, legalworkUrl: "http://127.0.0.1:8787" });
  assert.equal(env.VITE_LEGALWORK_TOKEN, "client-token");
  assert.equal(env.VITE_LEGALWORK_HOST_TOKEN, "host-token");
  assert.equal(env.VITE_LEGALWORK_URL, "http://127.0.0.1:8787");
});

test("localhost and ipv6 loopback count as loopback", () => {
  assert.equal(isLoopbackClientUrl("http://localhost:8787"), true);
  assert.equal(isLoopbackClientUrl("http://[::1]:8787"), true);
  assert.equal(headlessWebViteEnv({ ...input, legalworkUrl: "http://localhost:8787" }).VITE_LEGALWORK_HOST_TOKEN, "host-token");
});

test("a public client URL does not receive the host token", () => {
  const env = headlessWebViteEnv({ ...input, legalworkUrl: "http://100.64.0.8:8787" });
  assert.equal(env.VITE_LEGALWORK_TOKEN, "client-token");
  assert.equal(env.VITE_LEGALWORK_HOST_TOKEN, undefined);
});

test("an explicit host token in the environment is kept", () => {
  const env = headlessWebViteEnv({
    ...input,
    env: { VITE_LEGALWORK_HOST_TOKEN: "operator-host" },
    legalworkUrl: "http://127.0.0.1:8787",
  });
  assert.equal(env.VITE_LEGALWORK_HOST_TOKEN, "operator-host");
});
