import { expect, spyOn, test } from "bun:test";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";

test("connector modal status is scoped while grid status stays available", async () => {
  const urls: string[] = [];
  const original = globalThis.fetch;
  const mock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json({ configured: true, requiresSignIn: false, connectors: [] });
  }, { preconnect: original.preconnect }));
  try {
    const client = createLegalworkServerClient({ baseUrl: "http://local.invalid", token: "owner-token", hostToken: "host-token" });
    await client.connectorStatus("outlook-calendar");
    await client.connectorStatus("outlook-calendar", true);
    await client.connectorStatus();
    expect(urls).toEqual(["http://local.invalid/connectors/outlook-calendar", "http://local.invalid/connectors/outlook-calendar?refresh=true", "http://local.invalid/connectors"]);
  } finally { mock.mockRestore(); }
});
