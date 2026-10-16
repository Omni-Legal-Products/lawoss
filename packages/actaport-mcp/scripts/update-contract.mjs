import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

// Update the pin only after reviewing a new upstream API version.
const source = "https://api.actaport.de/api-docs/public-api.json";
const sha256 = "2d485ea84af6cbe526fa3b98f3cd097db63566a6c5ce4be0e2baa367e59e59aa";
if (!process.argv[2]) throw new Error("Usage: node scripts/update-contract.mjs /path/to/public-api.json");
const bytes = readFileSync(process.argv[2]);
if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("The source does not match the reviewed Actaport specification.");
const original = JSON.parse(bytes);
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const fields = new Set(["operationId", "summary", "description", "parameters", "requestBody"]);
const paths = Object.fromEntries(Object.entries(original.paths).filter(([path]) => !path.startsWith("/auth/"))
  .map(([path, entries]) => [path, Object.fromEntries(Object.entries(entries)
    .filter(([key]) => methods.has(key) || key === "parameters")
    .map(([key, value]) => [key, key === "parameters" ? value : Object.fromEntries(Object.entries(value).filter(([field]) => fields.has(field)))]))]));

const schemas = original.components.schemas;
const needed = new Set();
function include(reference) {
  if (typeof reference !== "string" || !reference.startsWith("#/components/schemas/")) return;
  const name = reference.slice("#/components/schemas/".length);
  if (needed.has(name)) return;
  if (!schemas[name]) throw new Error(`Missing schema: ${name}`);
  needed.add(name);
  visit(schemas[name]);
}
function visit(value) {
  if (!value || typeof value !== "object") return;
  include(value.$ref);
  for (const reference of Object.values(value.discriminator?.mapping ?? {})) include(reference);
  for (const item of Object.values(value)) visit(item);
}
visit(paths);
// A directly referenced subtype also needs the base's discriminator constraints.
for (let previous = -1; previous !== needed.size;) {
  previous = needed.size;
  for (const [name, schema] of Object.entries(schemas)) {
    if (Object.values(schema.discriminator?.mapping ?? {}).some(reference => needed.has(reference.split("/").at(-1)))) {
      include(`#/components/schemas/${name}`);
    }
  }
}
const contract = {
  openapi: original.openapi,
  info: original.info,
  "x-source": { url: source, sha256 },
  paths,
  components: { schemas: Object.fromEntries(Object.entries(schemas).filter(([name]) => needed.has(name))) },
};
writeFileSync(new URL("../contract.json", import.meta.url), JSON.stringify(contract, null, 2) + "\n");
console.log(`Retained ${Object.values(paths).flatMap(Object.keys).filter(key => methods.has(key)).length} operations and ${needed.size} input schemas.`);
