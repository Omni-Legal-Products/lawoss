import { describe, expect, test } from "bun:test";

import { MCP_QUICK_CONNECT } from "../src/app/constants";

describe("LAWOSS rýchle pripojenie MCP", () => {
  test("LegalMemory sa neponúka", () => {
    const names = MCP_QUICK_CONNECT.map((entry) => entry.serverName);
    expect(names).not.toContain("legalmemory");
  });

  test("katalóg neostal prázdny", () => {
    expect(MCP_QUICK_CONNECT.length).toBeGreaterThan(0);
  });
});
