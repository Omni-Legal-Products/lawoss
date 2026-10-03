import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEV_SERVER_ID_PATH, describeForeignDevServer, identifyDevServer } from "./dev-server-identity.mjs";

const OURS = "/repo/apps/app";
const URL = "http://127.0.0.1:5173";

/** @param {{ ok?: boolean; body: string }} reply */
const fetchReplying = (reply) => async (url) => {
  assert.equal(url, `${URL}${DEV_SERVER_ID_PATH}`);
  return new Response(reply.body, { status: reply.ok === false ? 404 : 200 });
};

describe("identifyDevServer", () => {
  it("prijme vlastný Vite server — hlási appRoot tohto checkoutu", async () => {
    const result = await identifyDevServer(URL, {
      appRoot: OURS,
      fetchImpl: fetchReplying({ body: JSON.stringify({ appRoot: OURS }) }),
    });
    assert.deepEqual(result, { status: "ours", reportedAppRoot: OURS });
  });

  it("odmietne cudzí Vite server bez markera (SPA fallback vráti index.html, #47)", async () => {
    const result = await identifyDevServer(URL, {
      appRoot: OURS,
      fetchImpl: fetchReplying({ body: "<!doctype html><title>BlechaLog</title>" }),
    });
    assert.deepEqual(result, { status: "foreign" });
  });

  it("odmietne LegalWork dev server z iného checkoutu a povie z ktorého", async () => {
    const result = await identifyDevServer(URL, {
      appRoot: OURS,
      fetchImpl: fetchReplying({ body: JSON.stringify({ appRoot: "/elsewhere/apps/app" }) }),
    });
    assert.deepEqual(result, { status: "foreign", reportedAppRoot: "/elsewhere/apps/app" });
  });

  it("odmietne odpoveď bez appRoot alebo s chybovým stavom", async () => {
    assert.deepEqual(
      await identifyDevServer(URL, { appRoot: OURS, fetchImpl: fetchReplying({ body: JSON.stringify({ hello: 1 }) }) }),
      { status: "foreign" },
    );
    assert.deepEqual(
      await identifyDevServer(URL, {
        appRoot: OURS,
        fetchImpl: fetchReplying({ ok: false, body: JSON.stringify({ appRoot: OURS }) }),
      }),
      { status: "foreign", reportedAppRoot: OURS },
    );
  });

  it("nebežiaci server → down (skript má spustiť vlastný)", async () => {
    const result = await identifyDevServer(URL, {
      appRoot: OURS,
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    assert.deepEqual(result, { status: "down" });
  });
});

describe("describeForeignDevServer", () => {
  it("poradí PORT= a pomenuje cudzí checkout", () => {
    const text = describeForeignDevServer({ url: URL, port: 5173, reportedAppRoot: "/elsewhere/apps/app" });
    assert.match(text, /PORT=5174 pnpm dev/);
    assert.match(text, /\/elsewhere\/apps\/app/);
    assert.doesNotMatch(describeForeignDevServer({ url: URL, port: 5173 }), /another checkout/);
  });
});
