/**
 * #264 (MČ 31. 10. 2026): kartu pre priečinok iného klienta vnoreného v klientovi chatu (aj natívny `read`, `edit`,
 * `glob`, `grep` či príkaz v priečinku chatu) otvorí plugin enginu so správou, za ktorou je koreň toho klienta
 * (`NESTED_CLIENT_CARD_PREFIX` v `apps/server/src/lawoss/linked-folders-rules.ts`), a kartu príkazu server s poľom
 * `otherClientFolder`. Karta potom vždy varuje o inom klientovi (aj pri klientovi bez karty v prehľade) a neponúka
 * zapamätanie.
 */
import type { PendingPermission } from "@/app/types";

export const NESTED_CLIENT_CARD_PREFIX = "LAWOSS other client folder: ";

/** Koreň iného klienta, pre ktorý plugin alebo server kartu otvoril; inak `null`. */
export function nestedClientCardFolder(permission: Pick<PendingPermission, "message" | "host">): string | null {
  const folder = permission.message?.startsWith(NESTED_CLIENT_CARD_PREFIX) ? permission.message.slice(NESTED_CLIENT_CARD_PREFIX.length).trim() : permission.host?.otherClientFolder?.trim();
  return folder || null;
}

/** Poznámka karty bez technickej správy pluginu o inom klientovi (tú nahrádza varovanie). */
export function permissionCardNote(message: string | undefined): string | null {
  return message && !message.startsWith(NESTED_CLIENT_CARD_PREFIX) ? message : null;
}
