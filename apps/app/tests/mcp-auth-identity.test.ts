import { describe, expect, test } from "bun:test";

import { MCP_QUICK_CONNECT, getMcpServerName, type McpDirectoryInfo } from "../src/app/constants";
import { deriveMcpServerName, resolveMcpSignInName, validateMcpServerName } from "../src/app/mcp";

/**
 * Issue #86: clicking "Log in" on a connector never opened the OAuth browser.
 *
 * The sign-in modal derived the server name by *validating* the display name
 * instead of slugifying it, so any connector whose display name was not already
 * a legal server name — every one with a space — threw before the authorization
 * URL was requested. These tests pin the modal's identity to the key connect
 * writes into opencode.jsonc.
 */

/** What connectMcp writes to opencode.jsonc and registers with the engine. */
const connectKey = (entry: McpDirectoryInfo) => entry.id ?? getMcpServerName(entry);

/** What the sign-in modal asks the engine to authenticate. */
const signInKey = resolveMcpSignInName;

const customConnector = (name: string): McpDirectoryInfo => ({
  name,
  description: "",
  type: "remote",
  url: "https://example.test/mcp",
  oauth: true,
});

describe("mcp sign-in identity", () => {
  test("a display name with a space still resolves to the registered server name", () => {
    const entry = customConnector("Iron Crow");
    expect(connectKey(entry)).toBe("iron-crow");
    expect(signInKey(entry)).toBe("iron-crow");
  });

  test("sign-in never rejects a display name the add-connector form accepts", () => {
    for (const name of ["Iron Crow", "IronCrow AI", "Dun & Bradstreet", "My Firm's Server"]) {
      const entry = customConnector(name);
      expect(() => signInKey(entry)).not.toThrow();
      expect(signInKey(entry)).toBe(connectKey(entry));
    }
  });

  test("underscores survive, because that is what connect wrote", () => {
    const entry = customConnector("Iron_Crow");
    expect(connectKey(entry)).toBe("iron_crow");
    expect(signInKey(entry)).toBe("iron_crow");
  });

  test("every built-in connector can be signed into", () => {
    const broken = MCP_QUICK_CONNECT.filter((entry) => {
      try {
        return signInKey(entry) !== connectKey(entry);
      } catch {
        return true;
      }
    }).map((entry) => entry.name);

    expect(broken).toEqual([]);
  });

  test("a declared serverName wins over the display name", () => {
    const entry: McpDirectoryInfo = { ...customConnector("Microsoft SharePoint"), serverName: "sharepoint" };
    expect(signInKey(entry)).toBe("sharepoint");
  });

  test("an explicit id wins over both", () => {
    const entry: McpDirectoryInfo = {
      ...customConnector("Google Workspace"),
      serverName: "workspace",
      id: "google-workspace",
    };
    expect(signInKey(entry)).toBe("google-workspace");
  });

  test("deriving a server name always produces one opencode accepts", () => {
    for (const name of ["Iron Crow", "  ", "!!!", "Dun & Bradstreet Risk Analytics", "-leading-dash-"]) {
      expect(() => validateMcpServerName(deriveMcpServerName(name))).not.toThrow();
    }
  });
});
