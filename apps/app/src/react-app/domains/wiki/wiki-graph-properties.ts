import type { WikiGraphNode, WikiValue } from "@legalwork/types/wiki";

export type GraphPropertyKind = "text" | "number" | "date" | "boolean" | "object";
export type GraphPropertyOperator = "eq" | "ne" | "contains" | "exists" | "missing" | "gt" | "gte" | "lt" | "lte" | "before" | "after";
export type GraphPropertyCondition = { property: string; kind: GraphPropertyKind; operator: GraphPropertyOperator; value: string };
const kinds: GraphPropertyKind[] = ["text", "number", "date", "boolean", "object"];
const operators: GraphPropertyOperator[] = ["eq", "ne", "contains", "exists", "missing", "gt", "gte", "lt", "lte", "before", "after"];

export function parseGraphCondition(input: unknown): GraphPropertyCondition | null {
  if (!input || typeof input !== "object" || !("property" in input) || typeof input.property !== "string" || !input.property
    || !("kind" in input) || !("operator" in input) || !("value" in input) || typeof input.value !== "string") return null;
  const kind = kinds.find(kind => kind === input.kind);
  const operator = operators.find(operator => operator === input.operator);
  return kind && operator ? { property: input.property, kind, operator, value: input.value } : null;
}
export type GraphPropertyField = { key: string; kind: GraphPropertyKind; options: string[] };

export function graphDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function values(value: WikiValue | undefined): Array<string | number | boolean> {
  if (Array.isArray(value)) return value.flatMap(values);
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) ? [value] : [];
}

/** Discover custom fields from the full graph, not only the currently visible nodes. */
export function graphPropertyFields(nodes: WikiGraphNode[]): GraphPropertyField[] {
  const fields = new Map<string, { kinds: Set<GraphPropertyKind>; options: Set<string> }>();
  for (const node of nodes) for (const [key, value] of Object.entries(node.properties ?? {})) {
    let field = fields.get(key);
    if (!field) { field = { kinds: new Set(), options: new Set() }; fields.set(key, field); }
    const scalars = values(value);
    if (value !== null && !Array.isArray(value) && typeof value === "object") field.kinds.add("object");
    for (const scalar of scalars) {
      field.kinds.add(typeof scalar === "number" ? "number" : typeof scalar === "boolean" ? "boolean" : graphDate(scalar) ? "date" : "text");
      if (field.options.size < 100) field.options.add(String(scalar));
    }
  }
  return [...fields].map(([key, field]): GraphPropertyField => ({
    key, kind: field.kinds.size === 1 ? [...field.kinds][0] : "text", options: [...field.options].sort(),
  })).sort((a, b) => a.key.localeCompare(b.key));
}

export function graphPropertyOperators(kind: GraphPropertyKind): GraphPropertyOperator[] {
  if (kind === "object") return ["exists", "missing"];
  const common: GraphPropertyOperator[] = ["eq", "ne"];
  return [...common, ...(kind === "number" ? ["gt", "gte", "lt", "lte"] satisfies GraphPropertyOperator[]
    : kind === "date" ? ["before", "after"] satisfies GraphPropertyOperator[]
      : kind === "text" ? ["contains"] satisfies GraphPropertyOperator[] : []), "exists", "missing"];
}

export function graphConditionNeedsValue(condition: GraphPropertyCondition) {
  return condition.operator !== "exists" && condition.operator !== "missing";
}

export function validGraphCondition(condition: GraphPropertyCondition): boolean {
  if (!graphPropertyOperators(condition.kind).includes(condition.operator)) return false;
  if (!graphConditionNeedsValue(condition)) return true;
  if (!condition.value.trim()) return false;
  if (condition.kind === "number") return Number.isFinite(Number(condition.value));
  if (condition.kind === "date") return graphDate(condition.value);
  if (condition.kind === "boolean") return condition.value === "true" || condition.value === "false";
  return true;
}

const normalize = (value: string) => value.normalize("NFC").toLocaleLowerCase();

export function matchesGraphCondition(properties: WikiGraphNode["properties"], condition: GraphPropertyCondition): boolean {
  if (!validGraphCondition(condition)) return false;
  const value = properties && Object.hasOwn(properties, condition.property) ? properties[condition.property] : undefined;
  const present = value !== undefined && value !== null;
  if (condition.operator === "exists") return present;
  if (condition.operator === "missing") return !present;
  if (!present) return false;
  const candidates = values(value).filter(actual => condition.kind === "number" ? typeof actual === "number"
    : condition.kind === "boolean" ? typeof actual === "boolean"
      : condition.kind === "date" ? typeof actual === "string" && graphDate(actual) : true);
  const matches = (actual: string | number | boolean) => {
    const expected = condition.value;
    if (condition.kind === "number") {
      if (typeof actual !== "number") return false;
      const number = Number(expected);
      switch (condition.operator) {
        case "gt": return actual > number;
        case "gte": return actual >= number;
        case "lt": return actual < number;
        case "lte": return actual <= number;
        default: return actual === number;
      }
    }
    if (condition.kind === "boolean") return typeof actual === "boolean" && actual === (expected === "true");
    if (condition.kind === "date") {
      if (typeof actual !== "string" || !graphDate(actual)) return false;
      return condition.operator === "before" ? actual < expected : condition.operator === "after" ? actual > expected : actual === expected;
    }
    return condition.operator === "contains" ? normalize(String(actual)).includes(normalize(expected)) : normalize(String(actual)) === normalize(expected);
  };
  // A list matches equality when any member matches; a negative condition requires
  // an actual value and excludes every matching member. Missing is explicit.
  return candidates.length > 0 && (condition.operator === "ne" ? candidates.every(actual => !matches(actual)) : candidates.some(matches));
}
