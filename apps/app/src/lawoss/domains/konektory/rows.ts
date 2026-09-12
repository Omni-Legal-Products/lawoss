/**
 * Čisté mapovanie dát zo Settings → Extensions na riadky stránky Konektory.
 * Zdroje sú tie isté, z ktorých číta upstream settings:
 *  - zoznam MCP: `client.listMcp` (react-app/domains/connections/store.ts),
 *  - stav MCP: `opencode.mcp.status` (react-app/domains/connections/use-mcp-connected-count.ts),
 *  - skills: `client.listSkills` (react-app/domains/settings/state/extensions-store.ts).
 * Modul importuje iba typy, aby sa dal testovať bez runtime aliasov.
 */
import type { LegalworkMcpItem, LegalworkSkillItem } from "@/app/lib/legalwork-server";

export type ConnectorTone = "ok" | "warn" | "err" | "off";

export type ConnectorRow = {
  key: string;
  name: string;
  /** URL alebo príkaz servera; popis skillu. */
  sub: string;
  /** Odkiaľ pochádza konfigurácia servera; rozsah skillu. */
  scope: string;
  /** Typ pripojenia a OAuth pri serveri; druh skillu. */
  ref: string;
  status: string;
  tone: ConnectorTone;
  /** Chybová hláška z opencode, ak server zlyhal. */
  error: string | null;
};

/** Tvar `opencode.mcp.status` aj `McpStatusMap` z app/types — oba sú sem priraditeľné bez castu. */
export type ConnectorStatusMap = Readonly<Record<string, { status: string; error?: string }>>;

const SOURCE_LABEL: Record<LegalworkMcpItem["source"], string> = {
  "config.project": "konfigurácia projektu",
  "config.global": "globálna konfigurácia",
  "config.remote": "vzdialená konfigurácia",
};

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mcpRow(item: LegalworkMcpItem, statuses: ConnectorStatusMap): ConnectorRow {
  const config = item.config;
  const remote = config.type === "remote";
  // Rovnaké pravidlo ako `supportsOauth` v settings/pages/mcp-view.tsx.
  const oauth = remote && config.oauth !== false;
  const sub = asString(config.url) ?? asStringList(config.command).join(" ");
  const base = {
    key: `mcp:${item.name}`,
    name: item.name,
    sub: sub || "—",
    scope: SOURCE_LABEL[item.source],
    ref: `${remote ? "remote" : "lokálne"}${oauth ? " · OAuth" : ""}`,
    error: null,
  };
  // Rovnaké poradie ako `resolveStatus` v settings/pages/mcp-view.tsx.
  if (config.enabled === false) return { ...base, status: "vypnuté", tone: "off" };
  const resolved = statuses[item.name];
  switch (resolved?.status) {
    case "connected":
      return { ...base, status: "pripojené", tone: "ok" };
    case "needs_auth":
    case "needs_client_registration":
      return { ...base, status: "vyžaduje prihlásenie", tone: "warn" };
    case "failed":
      return { ...base, status: "chyba", tone: "err", error: resolved.error ?? "neznáma chyba" };
    case "disabled":
      return { ...base, status: "vypnuté", tone: "off" };
    default:
      return { ...base, status: "odpojené", tone: "off" };
  }
}

function skillRow(item: LegalworkSkillItem): ConnectorRow {
  return {
    key: `skill:${item.scope}:${item.name}`,
    name: item.name,
    sub: item.description || "bez popisu",
    scope: item.scope === "global" ? "globálne" : "workspace",
    ref: item.kind === "workflow" ? "workflow" : "skill",
    status: "k dispozícii",
    tone: "ok",
    error: null,
  };
}

export function toConnectorRows(
  mcp: readonly LegalworkMcpItem[],
  statuses: ConnectorStatusMap,
  skills: readonly LegalworkSkillItem[],
): { servers: ConnectorRow[]; skills: ConnectorRow[] } {
  return {
    servers: mcp.map((item) => mcpRow(item, statuses)),
    skills: skills.map(skillRow),
  };
}
