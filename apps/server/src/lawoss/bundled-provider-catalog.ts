import { readFile } from "node:fs/promises";
import type { ProviderConfig } from "@opencode-ai/sdk/v2/client";
import { parseProviderModelCatalog } from "../provider-model-catalog.js";
import { bundledModelsCatalogPath } from "./engine-network.js";

/**
 * „Obnoviť modely“ vlastného poskytovateľa číta pribalený katalóg
 * (`lawoss/models-catalog/api.json`), ten istý, ktorý dostáva engine cez
 * `OPENCODE_MODELS_PATH`. Appka katalóg zo siete nesťahuje; obnovu katalógu robí
 * správca skriptom `lawoss/scripts/update-models-catalog.mjs`.
 */
export async function bundledProviderModelCatalog(
  providerId: string,
  catalogPath: string | null = bundledModelsCatalogPath(),
): Promise<NonNullable<ProviderConfig["models"]>> {
  if (!catalogPath) throw new Error("The bundled model catalog is missing from this installation.");
  const data: unknown = JSON.parse(await readFile(catalogPath, "utf8"));
  return parseProviderModelCatalog(data, providerId);
}
