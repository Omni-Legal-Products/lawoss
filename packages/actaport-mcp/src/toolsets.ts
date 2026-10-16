import { z } from "zod";
import manifest from "../toolsets.json" with { type: "json" };

export const toolsetSchema = z.enum(["records", "finance", "administration", "uploads"]);
export const toolsetsSchema = z.array(toolsetSchema).max(4).refine((ids) => new Set(ids).size === ids.length, "Tool groups must be unique.");
export type Toolset = z.infer<typeof toolsetSchema>;
export const coreToolCount = manifest.core.read.length;
export const toolsetSummaries = toolsetSchema.options.map((id) => ({ id,
  readTools: manifest[id].read.length, writeTools: manifest[id].write.length }));

/** Core is always included; optional groups never grant write permission. */
export function selectedOperationIds(toolsets: Toolset[] = [], allowWrites = false) {
  const groups = [manifest.core, ...toolsetsSchema.parse(toolsets).map((id) => manifest[id])];
  return new Set(groups.flatMap((group) => [...group.read, ...(allowWrites ? group.write : [])]));
}

export function selectOperations<T extends { operationId: string; readOnly: boolean }>(operations: T[], toolsets: Toolset[] = [], allowWrites = false) {
  const known = selectedOperationIds([...toolsetSchema.options], true);
  const all = Object.values(manifest).flatMap((group) => [...group.read, ...group.write]);
  if (known.size !== all.length || known.size !== operations.length || operations.some((operation) => !known.has(operation.operationId))) {
    throw new Error("Actaport API operations must each belong to one reviewed tool group.");
  }
  const selected = selectedOperationIds(toolsets, allowWrites);
  return operations.filter((operation) => selected.has(operation.operationId) && (allowWrites || operation.readOnly));
}

export function parseToolsets(value: string | undefined): Toolset[] {
  if (!value) return [];
  if (value === "all") return [...toolsetSchema.options];
  return toolsetsSchema.parse(value.split(",").map((id) => id.trim()));
}
