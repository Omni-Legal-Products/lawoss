/**
 * LAWOSS: „Povoliť pre toto sedenie“ pri karte úprav súborov a priečinka mimo chatu (MČ 2. 11. 2026).
 *
 * Engine 1.18.29 si „always“ pamätá pre celý priečinok klienta (všetky jeho chaty, do reštartu), preto ho
 * karta pri `edit` a `external_directory` neponúka (`offersRememberedApproval`). Toto povolenie drží appka
 * len v pamäti pre jeden chat: ďalšiu rovnakú otázku toho chatu odpovie „once“ sama, kým appka beží.
 * Úpravy súborov platia pre celý chat, priečinok mimo chatu len pre ten istý rozsah. Karta s varovaním
 * o inom klientovi sa vždy pýta (ako v YOLO, MČ 31. 10. 2026) a toto tlačidlo nemá. Zápis do pamäte prípadu
 * (`metadata.lawossMemory`) schvaľuje advokát vždy zvlášť, povolenie ho nepokryje.
 */
import type { PendingPermission } from "@/app/types";

type Kind = "edit" | "folder";
type Grant = { edit: boolean; folders: Set<string> };
type Request = Pick<PendingPermission, "protocol" | "permission" | "patterns" | "metadata">;

const grants = new Map<string, Grant>();

function kind(permission: Request): Kind | null {
  if (permission.protocol === "host") return null;
  if (permission.metadata && typeof permission.metadata === "object" && "lawossMemory" in permission.metadata) return null;
  if (permission.permission === "edit" || permission.permission === "lawoss_file_change") return "edit";
  if (permission.permission === "external_directory" && permission.patterns.length > 0) return "folder";
  return null;
}

/** Ponúknuť tlačidlo? Len pri úpravách a priečinku mimo chatu, nikdy pri varovaní o inom klientovi. */
export function offersSessionApproval(permission: Request, otherClientWarning: string | null): boolean {
  return kind(permission) !== null && !otherClientWarning;
}

/** Advokát zvolil „pre toto sedenie“: zapamätá sa pre chat, ktorý sa pýtal. */
export function rememberSessionApproval(permission: Request & Pick<PendingPermission, "sessionID">): void {
  const found = kind(permission);
  if (!found) return;
  const grant = grants.get(permission.sessionID) ?? { edit: false, folders: new Set<string>() };
  if (found === "edit") grant.edit = true;
  else for (const pattern of permission.patterns) grant.folders.add(pattern);
  grants.set(permission.sessionID, grant);
}

/** Pokrýva otázku skoršie povolenie niektorého z chatov (chat žiadosti alebo otvorený chat)? */
export function coveredBySessionApproval(permission: Request, chats: readonly string[]): boolean {
  const found = kind(permission);
  if (!found) return false;
  return chats.some((chat) => {
    const grant = grants.get(chat);
    if (!grant) return false;
    return found === "edit" ? grant.edit : permission.patterns.every((pattern) => grant.folders.has(pattern));
  });
}

/** Pre testy. */
export function clearSessionApprovals(): void {
  grants.clear();
}
