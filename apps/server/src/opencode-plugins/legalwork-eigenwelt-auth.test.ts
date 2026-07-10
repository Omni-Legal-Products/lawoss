import { describe, expect, test } from "bun:test";

import { LegalworkEigenweltAuth } from "./legalwork-eigenwelt-auth.js";

describe("legalwork eigenwelt auth plugin", () => {
  test("registers oauth + api methods for the eigenwelt provider", async () => {
    const plugin = await LegalworkEigenweltAuth();
    expect(plugin.auth.provider).toBe("eigenwelt");
    const types = plugin.auth.methods.map((method: { type: string }) => method.type);
    expect(types).toEqual(["oauth", "api"]);
  });

  test("authorize opens the platform interstitial with state, port, and PKCE challenge", async () => {
    const plugin = await LegalworkEigenweltAuth();
    const oauth = plugin.auth.methods.find((method: { type: string }) => method.type === "oauth");
    if (!oauth || !("authorize" in oauth) || typeof oauth.authorize !== "function") {
      throw new Error("oauth method missing authorize()");
    }

    const authorization = await oauth.authorize();
    try {
      const url = new URL(authorization.url);
      expect(url.pathname).toBe("/desktop/connect");
      expect(url.searchParams.get("state")?.length).toBeGreaterThanOrEqual(24);
      expect(url.searchParams.get("code_challenge")?.length).toBeGreaterThanOrEqual(40);
      const port = Number(url.searchParams.get("port"));
      expect([43117, 43118, 43119]).toContain(port);
      expect(authorization.method).toBe("auto");

      // The loopback must reject a callback whose state does not match.
      const bad = await fetch(`http://127.0.0.1:${port}/callback?code=x&state=wrong`);
      expect(bad.status).toBe(400);
    } finally {
      // Complete the flow so the loopback server and timeout are torn down.
      const url = new URL(authorization.url);
      const port = Number(url.searchParams.get("port"));
      const state = url.searchParams.get("state");
      await fetch(`http://127.0.0.1:${port}/callback?code=test-code&state=${state}`);
      // callback() will fail its platform exchange (no server in tests) and
      // must clean up the loopback rather than hang.
      const result = await authorization.callback();
      expect(result.type).toBe("failed");
    }
  });
});
