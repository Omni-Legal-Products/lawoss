import { expect, test } from "bun:test";
import manifest from "../toolsets.json";
import { buildOperations } from "../src/spec.js";
import { parseToolsets, selectOperations, toolsetSchema, toolsetSummaries } from "../src/toolsets.js";

const operations = buildOperations();

test("every API operation is classified exactly once, with matching read/write permissions", () => {
  const ids = Object.values(manifest).flatMap((group) => [...group.read, ...group.write]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(ids)).toEqual(new Set(operations.map((operation) => operation.operationId)));
  for (const group of Object.values(manifest)) for (const operation of operations) {
    if (group.read.some((id) => id === operation.operationId)) expect(operation.readOnly).toBe(true);
    if (group.write.some((id) => id === operation.operationId)) expect(operation.readOnly).toBe(false);
  }
});

test("default exposes fifteen everyday reads; opting into finance cannot enable writes", () => {
  const core = selectOperations(operations);
  expect(core).toHaveLength(15);
  expect(core.every((operation) => operation.readOnly)).toBe(true);
  expect(core.map((operation) => operation.operationId)).toContain("getDocumentDownloadStatus");
  expect(selectOperations(operations, [], true)).toHaveLength(15);
  const finance = selectOperations(operations, ["finance"]);
  expect(finance).toHaveLength(29);
  expect(finance.every((operation) => operation.readOnly)).toBe(true);
  expect(finance.map((operation) => operation.operationId)).toContain("getRechnungen");
  expect(finance.map((operation) => operation.operationId)).not.toContain("createKostenstelle");
  expect(selectOperations(operations, ["finance"], true)).toHaveLength(44);
  expect(selectOperations(operations, [...toolsetSchema.options])).toHaveLength(54);
  expect(selectOperations(operations, [...toolsetSchema.options], true)).toHaveLength(92);
  expect(toolsetSummaries.reduce((total, group) => total + group.readTools + group.writeTools, 15)).toBe(92);
});

test("configuration rejects unknown or duplicated groups; all is an explicit opt-in", () => {
  expect(parseToolsets(undefined)).toEqual([]);
  expect(parseToolsets("")).toEqual([]);
  expect(parseToolsets("finance, uploads")).toEqual(["finance", "uploads"]);
  expect(parseToolsets("all")).toEqual([...toolsetSchema.options]);
  expect(() => parseToolsets("finance,finance")).toThrow();
  expect(() => parseToolsets("all,finance")).toThrow();
  expect(() => parseToolsets("unknown")).toThrow();
  expect(() => selectOperations(operations.slice(1))).toThrow();
});

test("default tool schema footprint stays substantially below the complete catalog", () => {
  const core = JSON.stringify(selectOperations(operations).map(({ inputSchema, description }) => ({ inputSchema, description })));
  const full = JSON.stringify(selectOperations(operations, [...toolsetSchema.options], true)
    .map(({ inputSchema, description }) => ({ inputSchema, description })));
  expect(core.length).toBeLessThan(12_000);
  expect(core.length / full.length).toBeLessThan(0.15);
});
