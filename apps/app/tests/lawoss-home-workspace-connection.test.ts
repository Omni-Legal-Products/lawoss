import { expect, test } from "bun:test";
import { resolveActiveWorkspaceId } from "../src/lawoss/okf/connection";

const real = { id: "ws_client" };

test("aktívny domovský priestor sa nahradí skutočným priečinkom", () => {
  expect(resolveActiveWorkspaceId([real], "ws_home")).toBe("ws_client");
});
test("platné aktívne id ostáva", () => {
  expect(resolveActiveWorkspaceId([{ id: "a" }, real], "ws_client")).toBe("ws_client");
});
test("bez skutočného priečinka nie je aktívny žiadny", () => {
  expect(resolveActiveWorkspaceId([], "ws_home")).toBe("");
});
