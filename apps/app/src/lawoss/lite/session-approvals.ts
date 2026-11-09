/**
 * LAWOSS: „Povoliť pre toto sedenie“ pri karte úprav súborov a priečinka mimo chatu (MČ 2. 11. 2026).
 *
 * Engine 1.18.29 si „always“ pamätá pre celý priečinok klienta (všetky jeho chaty, do reštartu), preto ho
 * karta pri `edit` a `external_directory` neponúka (`offersRememberedApproval`). Toto povolenie drží appka
 * len v pamäti pre jeden chat: ďalšiu rovnakú otázku toho chatu odpovie „once“ sama, kým appka beží.
 * Úpravy súborov platia pre celý chat, priečinok mimo chatu len pre ten istý rozsah. Karta s varovaním
 * o inom klientovi sa vždy pýta (ako v YOLO, MČ 31. 10. 2026) a toto tlačidlo nemá. Zápis do pamäte prípadu
 * (`metadata.lawossMemory`) schvaľuje advokát vždy zvlášť, povolenie ho nepokryje. Rovnako zmazanie do Koša
 * (`lawossFiles[].operation === "delete"`, aj v dávke s presunmi): AGENTS.md žiada výslovné potvrdenie človekom.
 * Presuny, premenovania, kópie a nové priečinky povolenie pokrýva, MČ chce autonómny OpenCode (6. 11. 2026).
 */
import type { PendingPermission } from "@/app/types";
import { mayDeleteFiles } from "./file-operation-card";
import { nestedClientCardFolder } from "./nested-client-card";

type Kind = "edit" | "folder";
type Grant = { edit: boolean; folders: Set<string> };
type Request = Pick<PendingPermission, "protocol" | "permission" | "patterns" | "metadata"> & Partial<Pick<PendingPermission, "message" | "host">>;

const grants = new Map<string, Grant>();
/**
 * Kto na žiadosť práve odpovedá. Je mimo Reactu, lebo tú istú žiadosť vidí chat aj otvorený podagent a po
 * znovuotvorení chatu beží nový hook. „app“ ostáva aj po úspechu, žiadosť sa znova neodpovie.
 */
const replies = new Map<string, "app" | "lawyer">();
/** Odpoveď zlyhala: žiadosť ostáva na karte a appka za ňu už neodpovie. */
const leftToLawyer = new Set<string>();

function kind(permission: Request): Kind | null {
  if (permission.protocol === "host") return null;
  // #264: kartu iného klienta vnoreného v klientovi (aj `edit` či `read`) povolenie pre sedenie nepokryje.
  if (nestedClientCardFolder({ message: permission.message, host: permission.host })) return null;
  if (permission.metadata && typeof permission.metadata === "object" && "lawossMemory" in permission.metadata) return null;
  if (permission.metadata && typeof permission.metadata === "object" && mayDeleteFiles(permission.metadata)) return null;
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

/** Má appka odpovedať „once“ teraz? Pokrytá žiadosť, na ktorú ešte nikto neodpovedá a ktorej odpoveď nezlyhala. */
export function autoReplyDue(permission: Request & Pick<PendingPermission, "id">, chats: readonly string[]): boolean {
  return !replies.has(permission.id) && !leftToLawyer.has(permission.id) && coveredBySessionApproval(permission, chats);
}

/** Odpovedá za žiadosť appka? Taká žiadosť sa nesmie ukázať ako karta. */
export function answeredByApp(permission: Request & Pick<PendingPermission, "id">, chats: readonly string[]): boolean {
  return replies.get(permission.id) === "app" || autoReplyDue(permission, chats);
}

/** Vezme si žiadosť na odpoveď; `false`, keď na ňu už odpovedá niekto iný. */
export function claimPermissionReply(requestID: string, who: "app" | "lawyer"): boolean {
  if (replies.has(requestID)) return false;
  replies.set(requestID, who);
  return true;
}

/** Advokátova odpoveď dobehla, žiadosť už nikto nedrží. */
export function releasePermissionReply(requestID: string): void {
  replies.delete(requestID);
}

/** Odpoveď zlyhala: rozhodne advokát na karte. */
export function leavePermissionToLawyer(requestID: string): void {
  replies.delete(requestID);
  leftToLawyer.add(requestID);
}

/** Pre testy. */
export function clearSessionApprovals(): void {
  grants.clear();
  replies.clear();
  leftToLawyer.clear();
}
