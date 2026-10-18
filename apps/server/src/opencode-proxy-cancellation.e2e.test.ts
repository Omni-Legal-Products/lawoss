import { test } from "bun:test";
import { startServer } from "./server.js";
import { proxyCancellationCases, verifyProxyCancellation } from "./test-support/opencode-proxy-cancellation.js";

for (const scenario of proxyCancellationCases) {
  test(`Bun production engine proxy: ${scenario}`, () => verifyProxyCancellation(startServer, scenario), 10_000);
}
