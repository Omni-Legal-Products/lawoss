import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { requireBrowserNetwork } from "./browser-network-policy.mjs";

test("browser access follows the effective calling chat policy and fails closed", async t => {
  /** @type {unknown} */
  let settings = { enabled: true, networkMode: "allow" };
  let status = 200;
  const requests = [];
  const api = createServer((request, response) => {
    requests.push(request.url);
    assert.equal(request.headers.authorization, "Bearer fixture");
    response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(settings));
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  t.after(() => new Promise(resolve => api.close(resolve)));
  const address = api.address();
  assert.ok(address && typeof address !== "string");
  const server = { running: true, baseUrl: `http://127.0.0.1:${address.port}`, clientToken: "fixture" };
  const context = { workspaceId: "origin-project", sessionId: "origin-chat" };
  for (const enabled of [false, true]) {
    for (const networkMode of ["allow", "approve", "block"]) {
      settings = { enabled, networkMode };
      if (enabled && networkMode !== "allow") await assert.rejects(requireBrowserNetwork(context, server), /disabled/);
      else await requireBrowserNetwork(context, server);
    }
  }
  assert.deepEqual(new Set(requests), new Set(["/workspace/origin-project/sandbox/session/origin-chat"]));
  await assert.rejects(requireBrowserNetwork({}, server), /calling project and chat/);
  await assert.rejects(requireBrowserNetwork(context, { ...server, running: false }), /cannot be verified/);
  await assert.rejects(requireBrowserNetwork(context, { ...server, clientToken: "" }), /cannot be verified/);
  status = 503;
  await assert.rejects(requireBrowserNetwork(context, server), /cannot be verified/);
  status = 200;
  settings = {};
  await assert.rejects(requireBrowserNetwork(context, server), /invalid network policy/);
});
