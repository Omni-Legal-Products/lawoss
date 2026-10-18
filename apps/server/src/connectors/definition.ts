import { connectorDefinitions } from "./schema.js";
import { ApiError } from "../errors.js";

export function connectorDefinition(id: string) {
  const definition = connectorDefinitions.find((entry) => entry.id === id);
  if (!definition) throw new ApiError(404, "connector_not_found", "Connector not found.");
  return definition;
}

export function connectionProvider(id: string) {
  return connectorDefinition(id).connectionConnectorId ?? id;
}
