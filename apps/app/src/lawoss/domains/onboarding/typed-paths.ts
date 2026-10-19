/**
 * LAWOSS: napísané a vložené cesty onboardingu v tom istom tvare ako vybrané tlačidlom „Vybrať priečinok“.
 *
 * Dialóg vracia na Windows kanonickú cestu (`canonicalPickedDirectory` v desktope), pole s cestou nie:
 * cesta z Prieskumníka v úvodzovkách, malé písmeno disku, iná veľkosť písmen či namapovaný disk `Z:\`
 * neprešli kontrolou kanonickej cesty na serveri. Obal preto pred odoslaním prevedie každé pole
 * s cestou priečinka cez desktopový most (`canonicalDirectoryPath`). Mimo Windows most cestu vráti
 * bez zmeny, v prehliadači sa obal nepoužije (`welcome-route.tsx`).
 */
import type { Language } from "@/i18n";
import type { OnboardingApi } from "./api";

/** Prevod jednej cesty (v desktope `canonicalDirectoryPath`). */
export type CanonicalizePath = (value: string) => Promise<string>;
type PathApi = Pick<OnboardingApi, "classifyOnboarding" | "planOnboarding" | "updateOnboardingProfile"> & Pick<Partial<OnboardingApi>, "suggestOnboarding">;

/** Iba polia s cestou priečinka; názov, titul, subjekt, oblasť, pamäť ani kotvu identity nemeníme. */
const CLASSIFY_PATHS = ["root"] as const;
const PLAN_PATHS = ["parent", "root", "cloneParent", "clientRoot"] as const;
const PROFILE_PATHS = ["officeRoot", "clientRoot", "subjectRoot", "matterRoot"] as const;

/**
 * Cesta bez okrajov a úvodzoviek z „Kopírovať ako cestu“ (jedna na začiatku, jedna na konci, ako
 * `typedDirectoryInput` v desktope). Iba pre hodnoty, ktoré stránka z cesty odvodí: názov klienta,
 * rodiča a názov kópie. Samotné pole ide na server, ako je, a úvodzovky z neho zoberie most (iba Windows).
 * Mimo Windows je to bezpečné: absolútna cesta úvodzovkou nezačína, kópiu s úvodzovkou v názve server
 * odmietne (`safeSegment`) a predvolený názov klienta nanajvýš stratí úvodzovku na konci.
 */
export function unquotedTypedPath(value: string): string {
  // Okraje cez trim() ako server pri názve kópie a klienta (safeSegment), aj NBSP; úvodzovky ako most.
  return value.trim().replace(/^"/, "").replace(/"$/, "").trim();
}

/** Prevedená cesta; keď most zlyhá alebo nič nevráti, ide na server pôvodná a odmietne ju ako doteraz. */
export async function canonicalPathOf(value: string, canonicalize: CanonicalizePath): Promise<string> {
  try {
    const canonical = await canonicalize(value);
    return typeof canonical === "string" && canonical ? canonical : value;
  } catch {
    return value;
  }
}

async function withPaths<T extends object>(input: T, keys: readonly string[], canonicalize: CanonicalizePath): Promise<T> {
  const fields = input as Record<string, unknown>;
  const changed = await Promise.all(keys.map(async (key) => {
    const value = fields[key];
    // Prázdne pole aj `subjectRoot: null` (bez subjektu) idú ďalej bez zmeny.
    return typeof value === "string" && value.trim() ? [key, await canonicalPathOf(value, canonicalize)] as const : null;
  }));
  const entries = changed.filter((entry) => entry !== null);
  return entries.length ? { ...input, ...Object.fromEntries(entries) } : input;
}

export function withCanonicalPaths<T extends PathApi>(api: T, canonicalize: CanonicalizePath): T {
  // Návrh úrovne je voliteľný (staré náhrady API ho nemajú), preto sa obalí len keď existuje.
  const suggest = api.suggestOnboarding;
  return {
    ...api,
    ...(suggest ? { suggestOnboarding: async (input: { root: string }) => suggest(await withPaths(input, CLASSIFY_PATHS, canonicalize)) } : {}),
    classifyOnboarding: async (input: Parameters<PathApi["classifyOnboarding"]>[0]) =>
      api.classifyOnboarding(await withPaths(input, CLASSIFY_PATHS, canonicalize)),
    planOnboarding: async (request: Parameters<PathApi["planOnboarding"]>[0]) =>
      api.planOnboarding(await withPaths(request, PLAN_PATHS, canonicalize)),
    updateOnboardingProfile: async (profile: Parameters<PathApi["updateOnboardingProfile"]>[0]) =>
      api.updateOnboardingProfile(await withPaths(profile, PROFILE_PATHS, canonicalize)),
  };
}

/**
 * Odmietnutia nekanonickej cesty zo servera (`apps/server/src/lawoss/onboarding.ts`, register
 * pracovných priestorov) a z OKF (`lawoss/okf/src/onboarding/*`) pri ceste, ktorú advokát zadal.
 * Priečinok aplikácie (žurnál) a cesta k pamäti (pole bez tlačidla) sem nepatria: tlačidlo nepomôže.
 */
const CANONICAL_PATH_REJECTIONS = new Set([
  "Choose an existing canonical directory.",
  "registerExisting requires an existing canonical directory",
  "Parent must be a canonical existing directory.",
  "Plan root must be a canonical directory.",
  "Plan root must be canonical.",
  "Trial cloning requires existing canonical directories.",
]);
// Chýbajúci priečinok niektoré kontroly neodchytia a ostane chyba `realpath` z Node.js (server beží v procese Electronu).
const MISSING_DIRECTORY = /^(?:ENOENT: no such file or directory|ENOTDIR: not a directory), realpath '(.+)'$/;
/** Server: vybraný priečinok profilu neexistuje (`folder_missing`, detail `{ key, name }`). */
export const FOLDER_MISSING_CODE = "folder_missing";
/**
 * Priečinok, ktorý zmizol (presunutý, premenovaný, zmazaný), sa volá menom; veta o odkaze (junction) by advokáta
 * poslala hľadať problém, ktorý nemá (test 19. 10. 2026). Kancelária má vlastnú vetu, ostatné priečinky spoločnú.
 */
const folderNotFound: Record<Language, { office: (name: string) => string; folder: (name: string) => string }> = {
  sk: {
    office: (name) => `Priečinok kancelárie ${name} sa nenašiel. Možno bol presunutý alebo premenovaný. Vyberte ho znova tlačidlom „Vybrať priečinok“.`,
    folder: (name) => `Priečinok ${name} sa nenašiel. Možno bol presunutý alebo premenovaný. Vyberte ho znova tlačidlom „Vybrať priečinok“.`,
  },
  cs: {
    office: (name) => `Složka kanceláře ${name} nebyla nalezena. Možná byla přesunuta nebo přejmenována. Vyberte ji znovu tlačítkem „Vybrat složku“.`,
    folder: (name) => `Složka ${name} nebyla nalezena. Možná byla přesunuta nebo přejmenována. Vyberte ji znovu tlačítkem „Vybrat složku“.`,
  },
  en: {
    office: (name) => `The office folder ${name} was not found. It may have been moved or renamed. Choose it again with the "Choose folder" button.`,
    folder: (name) => `The folder ${name} was not found. It may have been moved or renamed. Choose it again with the "Choose folder" button.`,
  },
  de: {
    office: (name) => `Der Kanzleiordner ${name} wurde nicht gefunden. Möglicherweise wurde er verschoben oder umbenannt. Wählen Sie ihn erneut mit der Schaltfläche „Ordner wählen“.`,
    folder: (name) => `Der Ordner ${name} wurde nicht gefunden. Möglicherweise wurde er verschoben oder umbenannt. Wählen Sie ihn erneut mit der Schaltfläche „Ordner wählen“.`,
  },
};
const lastPathSegment = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Priečinok, ktorý neexistuje: kód servera `folder_missing` alebo surová chyba `realpath`; iné chyby `undefined`. */
export function folderNotFoundMessage(error: unknown, locale: Language): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const details = "details" in error && record(error.details) ? error.details : undefined;
  if ("code" in error && error.code === FOLDER_MISSING_CODE && typeof details?.name === "string") {
    return folderNotFound[locale][details.key === "officeRoot" ? "office" : "folder"](details.name);
  }
  const raw = MISSING_DIRECTORY.exec(error.message)?.[1];
  return raw ? folderNotFound[locale].folder(lastPathSegment(raw)) : undefined;
}
const canonicalPathRejected: Record<Language, string> = {
  sk: "Priečinok neexistuje alebo cesta k nemu vedie cez odkaz (junction). Vyberte ho tlačidlom „Vybrať priečinok“.",
  cs: "Složka neexistuje nebo cesta k ní vede přes odkaz (junction). Vyberte ji tlačítkem „Vybrat složku“.",
  en: "The folder does not exist or its path leads through a link (junction). Choose it with the \"Choose folder\" button.",
  de: "Der Ordner existiert nicht oder sein Pfad führt über eine Verknüpfung (Junction). Wählen Sie ihn mit der Schaltfläche „Ordner wählen“.",
};

/** Zrozumiteľná náhrada odmietnutej cesty v jazyku rozhrania; iné chyby vráti ako `undefined`. */
export function canonicalPathRejection(error: unknown, locale: Language): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return CANONICAL_PATH_REJECTIONS.has(error.message) ? canonicalPathRejected[locale] : undefined;
}
