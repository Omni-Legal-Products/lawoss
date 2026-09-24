import { describe, expect, test } from "bun:test";
import { LAWOSS_ROUTES } from "../src/lawoss/shell/routes";
import { NativeIntegrationsRedirect } from "../src/lawoss/domains/marketplace/native-redirect";
import { nativeIntegrationRoute } from "../src/lawoss/domains/marketplace/native-actions";

describe("staré trasy /konektory a /marketplace", () => {
  test("vedou rovnou do nativních integrací vybrané složky", () => {
    for (const from of ["/konektory", "/marketplace"]) {
      const route = LAWOSS_ROUTES.find((r) => r.path === from);
      expect(route?.element.type).toBe(NativeIntegrationsRedirect);
      expect((route?.element.props as { from: string }).from).toBe(from);
    }
    expect(nativeIntegrationRoute("/konektory", "selected-folder")).toBe("/workspace/selected-folder/settings/extensions/mcp");
  });
});
