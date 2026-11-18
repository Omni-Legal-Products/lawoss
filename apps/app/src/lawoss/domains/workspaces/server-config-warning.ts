/**
 * #553: server pri poškodenom server.json pridá do `warnings` zoznamu klientov kódované varovanie
 * `LAWOSS_SERVER_CONFIG_DAMAGED|<druh>|<cesta>` (`apps/server/src/lawoss/server-config-recovery.ts`).
 * Appka ho ukáže raz ako preloženú notifikáciu; ostatné varovania idú ďalej bez zmeny.
 */
import { t } from "@/i18n";
import { notifyAlert } from "@/react-app/shell/notifications";

const PREFIX = "LAWOSS_SERVER_CONFIG_DAMAGED|";

const MESSAGES = {
  repaired: "lawoss.server_config.repaired",
  reset: "lawoss.server_config.reset",
  restored: "lawoss.server_config.restored",
  kept: "lawoss.server_config.kept",
} as const;

export type ServerConfigDamage = { kind: keyof typeof MESSAGES; path: string };

const isKind = (value: string): value is ServerConfigDamage["kind"] => Object.hasOwn(MESSAGES, value);

function parse(warning: string): ServerConfigDamage | null {
  if (!warning.startsWith(PREFIX)) return null;
  const rest = warning.slice(PREFIX.length);
  const separator = rest.indexOf("|");
  const kind = rest.slice(0, separator);
  return separator > 0 && isKind(kind) ? { kind, path: rest.slice(separator + 1) } : null;
}

export function splitServerConfigWarnings(warnings: readonly string[]): { damage: ServerConfigDamage[]; others: string[] } {
  const damage: ServerConfigDamage[] = [];
  const others: string[] = [];
  for (const warning of warnings) {
    const parsed = parse(warning);
    if (parsed) damage.push(parsed); else others.push(warning);
  }
  return { damage, others };
}

export function serverConfigWarningNotice(damage: ServerConfigDamage): { title: string; body: string } {
  return { title: t("lawoss.server_config.title"), body: t(MESSAGES[damage.kind], { path: damage.path }) };
}

const announced = new Set<string>();

/** Ukáže varovanie o poškodenom server.json raz za behu appky a vráti ostatné varovania. */
export function announceServerConfigWarnings(warnings: readonly string[] | undefined): string[] {
  const { damage, others } = splitServerConfigWarnings(warnings ?? []);
  for (const item of damage) {
    const key = `${item.kind}|${item.path}`;
    if (announced.has(key)) continue;
    announced.add(key);
    notifyAlert({ kind: "system", ...serverConfigWarningNotice(item), dedupeKey: `lawoss-server-config-${key}` });
  }
  return others;
}
