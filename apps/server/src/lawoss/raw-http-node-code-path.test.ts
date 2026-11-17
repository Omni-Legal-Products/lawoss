// #440: the generated HTTP worker bundle is the same on every machine; it carries no absolute path of the build machine.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { RAW_HTTP_NODE_CODE } from "../agent-sandbox/raw-http-node-code.js";

test("raw-http-node-code.ts neobsahuje absolútnu cestu stroja, na ktorom vznikol", () => {
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  expect(RAW_HTTP_NODE_CODE).not.toContain(repository);
  expect(RAW_HTTP_NODE_CODE).not.toContain("node_modules/.pnpm/");
  expect(RAW_HTTP_NODE_CODE).not.toMatch(/var __(?:filename|dirname)=/);
  expect(RAW_HTTP_NODE_CODE).not.toMatch(/["'](?:\/Users\/|\/home\/|\/workspace\/|[A-Za-z]:\\\\)/);
});
