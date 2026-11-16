import { useEffect, useState } from "react";
import { getMcpServerName, type McpDirectoryInfo } from "../../../app/constants";
import { isSkillHiddenByDefault } from "@/lawoss/feature-flags";

const EXTENSION_DISABLED_KEY_PREFIX = "legalwork.extension.disabled.";
const EXTENSION_ENABLED_KEY_PREFIX = "legalwork.extension.enabled.";
const EXTENSION_HIDDEN_KEY_PREFIX = "legalwork.extension.hidden.";
export const LEGALWORK_EXTENSION_STATE_CHANGED = "legalwork:extension-state-changed";

export function getExtensionId(entry: McpDirectoryInfo): string {
  return entry.id ?? entry.serverName ?? getMcpServerName(entry);
}

export function isLegalWorkExtensionEnabled(entry: McpDirectoryInfo): boolean {
  if (typeof window === "undefined") return Boolean(entry.defaultEnabled);
  const id = getExtensionId(entry);
  if (!entry.defaultEnabled) return window.localStorage.getItem(`${EXTENSION_ENABLED_KEY_PREFIX}${id}`) === "1";
  return window.localStorage.getItem(`${EXTENSION_DISABLED_KEY_PREFIX}${id}`) !== "1";
}

export function setLegalWorkExtensionEnabled(entry: McpDirectoryInfo, enabled: boolean) {
  if (typeof window === "undefined") return;
  const id = getExtensionId(entry);
  if (entry.defaultEnabled) {
    const disabledKey = `${EXTENSION_DISABLED_KEY_PREFIX}${id}`;
    if (enabled) {
      window.localStorage.removeItem(disabledKey);
    } else {
      window.localStorage.setItem(disabledKey, "1");
    }
  } else {
    const enabledKey = `${EXTENSION_ENABLED_KEY_PREFIX}${id}`;
    if (enabled) {
      window.localStorage.setItem(enabledKey, "1");
    } else {
      window.localStorage.removeItem(enabledKey);
    }
  }
  window.dispatchEvent(new CustomEvent(LEGALWORK_EXTENSION_STATE_CHANGED, {
    detail: { id, enabled },
  }));
}

export function isLegalWorkExtensionHidden(entryOrId: McpDirectoryInfo | string): boolean {
  const id = typeof entryOrId === "string" ? entryOrId : getExtensionId(entryOrId);
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem(`${EXTENSION_HIDDEN_KEY_PREFIX}${id}`);
  if (stored === "1") return true;
  if (stored === "0") return false;
  // 🟡 LAWOSS: balíky lehôt LegalWorku sú v katalógu predvolene skryté (`lawoss/feature-flags.ts`).
  if (typeof entryOrId === "string") return id.startsWith("skill:") && isSkillHiddenByDefault(id.slice("skill:".length));
  return entryOrId.defaultHidden === true;
}

export function setLegalWorkExtensionHidden(entryOrId: McpDirectoryInfo | string, hidden: boolean) {
  const id = typeof entryOrId === "string" ? entryOrId : getExtensionId(entryOrId);
  if (typeof window === "undefined") return;
  const key = `${EXTENSION_HIDDEN_KEY_PREFIX}${id}`;
  window.localStorage.setItem(key, hidden ? "1" : "0");
  window.dispatchEvent(new CustomEvent(LEGALWORK_EXTENSION_STATE_CHANGED, {
    detail: { id, hidden },
  }));
}

/**
 * 🟡 LAWOSS #514: Nastavenia → Workflows → Skills ukazujú len skilly, ktoré nie sú skryté. Rovnaká voľba
 * ako v katalógu integrácií a v ponuke „/“; balíky lehôt upstreamu sú predvolene skryté
 * (`isSkillHiddenByDefault`, N-A3-4) a advokát ich môže v katalógu odkryť.
 */
export function visibleSettingsSkills<T extends { name: string }>(skills: readonly T[]): T[] {
  return skills.filter((skill) => !isLegalWorkExtensionHidden(`skill:${skill.name}`));
}

/** 🟡 LAWOSS #514: zvýši sa pri každej zmene skrytia v katalógu, aby sa zoznam skillov prepočítal. */
export function useExtensionHiddenVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    window.addEventListener(LEGALWORK_EXTENSION_STATE_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LEGALWORK_EXTENSION_STATE_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return version;
}
