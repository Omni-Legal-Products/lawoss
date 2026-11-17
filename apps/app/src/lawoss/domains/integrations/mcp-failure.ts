import { t } from "../../../i18n";

/**
 * LAWOSS: surovú chybu MCP servera (npm, TLS, sieť) prekladá na vetu, ktorej advokát rozumie.
 * Doplnky z LAWOSS Marketplace si pri prvom spustení pripravujú súčasti; v sieti, ktorá kontroluje
 * šifrované spojenia, to zlyhá a pôvodný text bol viacriadkový anglický výpis npm.
 */
export type McpFailureKind = "inspection" | "offline" | "timeout" | "install" | "other";

export function mcpFailureKind(error: string | null | undefined): McpFailureKind {
  const text = String(error ?? "");
  if (/UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|UNABLE_TO_GET_ISSUER_CERT|CERT_HAS_EXPIRED|certificate/i.test(text)) return "inspection";
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|network access/i.test(text) && !/Exit handler never called/i.test(text)) return "offline";
  if (/ETIMEDOUT|timed out|timeout/i.test(text)) return "timeout";
  if (/Dependency installation failed|npm error|Installing locked local dependencies|npm is required/i.test(text)) return "install";
  return "other";
}

/** Veta pre používateľa; pri neznámej chybe ostane pôvodný text (skrátený), aby sa dal nahlásiť. */
export function mcpFailureText(error: string | null | undefined): string {
  const kind = mcpFailureKind(error);
  if (kind === "other") return String(error ?? "").trim().slice(0, 400) || t("mcp.connection_failed");
  return t(`lawoss.integrations.mcp_failure.${kind}`);
}
