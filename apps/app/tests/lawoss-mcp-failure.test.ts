import { describe, expect, test } from "bun:test";
import { mcpFailureKind } from "../src/lawoss/domains/integrations/mcp-failure";

describe("LAWOSS: zrozumiteľný dôvod zlyhania doplnku", () => {
  test("kontrola šifrovaných spojení (firewall) sa pozná podľa chyby certifikátu", () => {
    expect(mcpFailureKind("npm error code UNABLE_TO_VERIFY_LEAF_SIGNATURE")).toBe("inspection");
    expect(mcpFailureKind("request failed, reason: self-signed certificate in certificate chain")).toBe("inspection");
  });
  test("výpis z alpha.12 za firewallom je zlyhanie prípravy súčastí", () => {
    const seen = "MCP server process exited with code 1: [LAWOSS ORSR] Installing locked local dependencies for this runtime version…\nnpm error Exit handler never called!\n[LAWOSS] Dependency installation failed; check npm/network access and retry.";
    expect(mcpFailureKind(seen)).toBe("install");
  });
  test("sieť a čas", () => {
    expect(mcpFailureKind("getaddrinfo ENOTFOUND registry.npmjs.org")).toBe("offline");
    expect(mcpFailureKind("MCP error -32001: Request timed out")).toBe("timeout");
  });
  test("neznáma chyba ostane neznáma", () => {
    expect(mcpFailureKind("Unexpected token < in JSON")).toBe("other");
    expect(mcpFailureKind(undefined)).toBe("other");
  });
});
