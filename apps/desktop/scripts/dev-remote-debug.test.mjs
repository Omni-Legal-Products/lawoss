import test from "node:test";
import assert from "node:assert/strict";

import { parseRemoteDebugPort, remoteDebugEnv } from "./dev-remote-debug.mjs";

test("bez premennej sa ladiaci port neotvára", () => {
  assert.deepEqual(remoteDebugEnv({}), {});
  assert.deepEqual(remoteDebugEnv({ LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT: "" }), {});
  assert.deepEqual(remoteDebugEnv(undefined), {});
});

test("platný port sa odovzdá ďalej", () => {
  assert.deepEqual(remoteDebugEnv({ LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT: "9823" }), {
    LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT: "9823",
  });
  assert.deepEqual(remoteDebugEnv({ LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT: " 9222 " }), {
    LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT: "9222",
  });
});

test("nezmysel sa ignoruje, nie dosadí", () => {
  for (const raw of ["zapni", "0", "70000", "-1", "98 23", "9823;rm"]) {
    assert.equal(parseRemoteDebugPort(raw), null, raw);
    assert.deepEqual(remoteDebugEnv({ LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT: raw }), {}, raw);
  }
});
