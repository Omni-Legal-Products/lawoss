/**
 * N-A7-14 (test E2, 28. 10. 2026): v chate klienta C001 agent žiadal `external_directory` s rozsahom `…/Klienti/C002*` (vzor s lomkou a hviezdičkou na konci)
 * a karta „Pristúpiť k externému priečinku?“ nepovedala, že ide o priečinok iného klienta tej istej praxe.
 *
 * Priečinok iného klienta (podľa karty klienta) odmietne už plugin enginu `lawoss-linked-folders`
 * (`externalDirectoryOtherClient` na serveri), karta sa preto ukáže len vtedy, keď plugin nerozhodne (napr. firemné
 * pravidlá, vzor cez celý priečinok klientov, neisté znaky). Táto veta je pre ten prípad: karta povie meno klienta z prehľadu.
 * Iba zobrazenie, o prístupe nerozhoduje.
 */
import { t } from "@/i18n";
import type { PendingPermission } from "@/app/types";
import { overviewFolder } from "./client-projects";
import { cleanTitle } from "./client-titles";
import { useClientNav } from "./client-nav";
import { comparable, within } from "./matter-conversations";

/** Klient z prehľadu OKF: priečinok s kartou klienta (`client.md`/`klient.md`), absolútne, a jeho meno. */
export type CardClient = { folder: string; name: string };
export type OtherClientFolder = { kind: "inside"; name: string } | { kind: "contains"; names: string[] } | { kind: "uncertain" };

const GLOB = /[*?]/;
/** Ako `UNCERTAIN_CHARS` na serveri: pri týchto znakoch sa nedá povedať, kam rozsah siaha. */
const UNCERTAIN = /[[\]{}$`]/;
const segments = (path: string): string[] => path.split("/").filter(Boolean);
const segmentPattern = (segment: string): RegExp =>
  new RegExp(`^${segment.replace(/[.+^$|()[\]{}\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "isu");

/** Priečinok vzoru otázky (`<priečinok>/*`, ako `patternDirectory` na serveri); iný tvar `null`. */
function patternFolder(pattern: string): string | null {
  if (!/[\\/]\*$/.test(pattern)) return null;
  return comparable(pattern.slice(0, -2).replace(/\\/g, "/") || "/");
}

/**
 * Ako `patternRelation` na serveri: `inside` = priečinok (aj vzor s `*`, `?`, `**`) je `root` alebo leží v ňom,
 * `contains` = je jeho predkom (`…/Klienti`, `…/Prax/K*`), inak `null`. Po segmentoch, bez ohľadu na veľkosť písmen.
 */
function relation(folder: string, root: string): "inside" | "contains" | null {
  const wanted = segments(folder), parts = segments(root);
  for (let index = 0; index < parts.length; index++) {
    const segment = wanted[index];
    if (segment === undefined) return "contains";
    if (segment === "**") return "inside";
    if (GLOB.test(segment) ? !segmentPattern(segment).test(parts[index]!) : segment.toLowerCase() !== parts[index]!.toLowerCase()) return null;
  }
  return "inside";
}

/**
 * Patrí rozsah otázky inému klientovi ako klient chatu? Klient = priečinok s kartou (spisy klienta sú ten istý klient).
 * `inside`: cieľ leží v inom klientovi alebo sa vzor rozvinie len naň; `contains`: cieľ alebo vzor siaha aj na iných
 * klientov (`…/Klienti`, `…/Klienti/*`, `…/Prax/K*`); `uncertain`: rozsah so znakmi `[ ] { } $ \``. Chat mimo známeho
 * klienta sa nerieši.
 */
export function otherClientFolder(patterns: readonly string[], chatDirectory: string | null | undefined, clients: readonly CardClient[]): OtherClientFolder | null {
  if (!chatDirectory?.trim()) return null;
  const chat = comparable(chatDirectory);
  // Porovnáva sa zjednotene (`comparable`: NFC, na macOS a Windows bez veľkosti písmen), ako priečinok chatu.
  const byDepth = clients.map((client) => ({ ...client, folder: comparable(client.folder) })).sort((a, b) => b.folder.length - a.folder.length);
  const own = byDepth.find((client) => within(client.folder, chat));
  if (!own) return null;
  const contained = new Set<string>();
  let uncertain = false;
  for (const pattern of patterns) {
    const folder = patternFolder(pattern);
    if (!folder) continue;
    if (UNCERTAIN.test(folder)) { uncertain = true; continue; }
    const others = byDepth.filter((client) => client !== own);
    const reached = others.filter((client) => relation(folder, client.folder) === "inside");
    const holds = others.filter((client) => relation(folder, client.folder) === "contains");
    const ownTouched = relation(folder, own.folder) !== null;
    if (GLOB.test(folder)) {
      if (!ownTouched && reached.length === 1 && !holds.length) return { kind: "inside", name: reached[0]!.name };
    } else {
      // Cesta bez `*` patrí najhlbšiemu klientovi (klient vnútri klienta je iný klient).
      const deepest = byDepth.find((client) => relation(folder, client.folder) === "inside");
      if (deepest && deepest !== own) return { kind: "inside", name: deepest.name };
    }
    for (const client of GLOB.test(folder) ? [...reached, ...holds] : holds) contained.add(client.name);
  }
  if (contained.size) return { kind: "contains", names: [...contained] };
  return uncertain ? { kind: "uncertain" } : null;
}

/** Veta karty: meno iného klienta, až tri mená klientov, na ktorých priečinky rozsah siaha, alebo neistý rozsah. */
export function otherClientFolderText(found: OtherClientFolder | null): string | null {
  if (!found) return null;
  if (found.kind === "uncertain") return t("lawoss.permission_card.uncertain_scope");
  const shown = found.kind === "inside" ? found.name : found.names.slice(0, 3).join(", ") + (found.names.length > 3 ? ` +${found.names.length - 3}` : "");
  const text = found.kind === "inside" ? t("lawoss.permission_card.other_client", undefined, { name: shown }) : t("lawoss.permission_card.other_clients_inside", undefined, { names: shown });
  // Meno končiace bodkou („a. s.“) bez druhej bodky za ním.
  return shown.endsWith(".") ? text.replace(`${shown}.`, shown) : text;
}

const folderName = (folder: string): string => folder.replace(/\/+$/, "").split("/").pop() ?? folder;

/** Pre kartu `external_directory`: veta o inom klientovi podľa klientov s kartou z prehľadu bočného panela; inak `null`. */
export function useOtherClientFolderText(permission: Pick<PendingPermission, "permission" | "patterns">, chatDirectory: string | null | undefined): string | null {
  const nav = useClientNav();
  if (permission.permission !== "external_directory") return null;
  const scope = nav?.scope;
  const clients = scope ? (nav?.data?.clients ?? []).flatMap((client) => {
    const folder = overviewFolder(scope, client.path);
    return folder ? [{ folder, name: (client.title ? cleanTitle(client.title) : undefined) ?? folderName(folder) }] : [];
  }) : [];
  return otherClientFolderText(otherClientFolder(permission.patterns, chatDirectory, clients));
}
