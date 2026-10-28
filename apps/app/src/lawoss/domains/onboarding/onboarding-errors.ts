/**
 * Chyby onboardingu pre advokáta (spec #92, MČ 19. 10. 2026). Bez Reactu: používa ich stránka onboardingu
 * aj obrazovka „Toto som našiel“, ktorú stránka importuje (bez kruhového importu).
 */
import { t, type Language } from "@/i18n";
import {
  INSIDE_OFFICE_MESSAGE_PREFIX,
  LOCKED_FILE_CODE,
  LOCKED_FILES_MESSAGE_PREFIX,
  OFFICE_EXISTS_MESSAGE,
  UNSAFE_FOLDER_NAME_MESSAGE,
} from "../../../../../../lawoss/okf/src/onboarding/messages";
import { OFFICE_CONFIG_ENCODING_MESSAGE } from "../../../../../../lawoss/okf/src/profile";
import { foundText } from "./found-text";
import { canonicalPathRejection, folderNotFoundMessage } from "./typed-paths";
import { movedClientChoice } from "../../okf/moved-folder";

/** „Začať nanovo“ do neprázdneho priečinka (folder-step.tsx); appka ho vysvetlí vetou kroku Priečinok. */
export const FRESH_NOT_EMPTY = "fresh_not_empty";

const unsafeFolderName: Record<Language, string> = {
  sk: "Názov priečinka nesmie byť prázdny, začínať bodkou, obsahovať znaky / \\ : < > \" | ? * ani mať viac ako 120 znakov. Bodky vnútri názvu, napríklad „s. r. o.“, sú v poriadku.",
  cs: "Název složky nesmí být prázdný, začínat tečkou, obsahovat znaky / \\ : < > \" | ? * ani mít více než 120 znaků. Tečky uvnitř názvu, například „s. r. o.“, jsou v pořádku.",
  en: "The folder name must not be empty, start with a dot, contain / \\ : < > \" | ? * or be longer than 120 characters. Dots inside the name, such as \"s. r. o.\", are fine.",
  de: "Der Ordnername darf nicht leer sein, nicht mit einem Punkt beginnen, keine Zeichen / \\ : < > \" | ? * enthalten und nicht länger als 120 Zeichen sein. Punkte im Namen, etwa „s. r. o.“, sind zulässig.",
};
/** Zamknutý súbor z neúplnej inšpekcie (Windows: dokument otvorený vo Worde); cesty sú zo správy servera. */
const lockedFiles: Record<Language, (paths: string, many: boolean) => string> = {
  sk: (paths, many) =>
    many
      ? `Súbory sú otvorené v inej aplikácii (napríklad vo Worde) alebo k nim nie je prístup: ${paths}. Zatvorte ich a skúste to znova.`
      : `Súbor je otvorený v inej aplikácii (napríklad vo Worde) alebo k nemu nie je prístup: ${paths}. Zatvorte ho a skúste to znova.`,
  cs: (paths, many) =>
    many
      ? `Soubory jsou otevřené v jiné aplikaci (například ve Wordu) nebo k nim není přístup: ${paths}. Zavřete je a zkuste to znovu.`
      : `Soubor je otevřený v jiné aplikaci (například ve Wordu) nebo k němu není přístup: ${paths}. Zavřete ho a zkuste to znovu.`,
  en: (paths, many) =>
    many
      ? `Files are open in another application (for example Word) or cannot be accessed: ${paths}. Close them and try again.`
      : `A file is open in another application (for example Word) or cannot be accessed: ${paths}. Close it and try again.`,
  de: (paths, many) =>
    many
      ? `Dateien sind in einer anderen Anwendung geöffnet (zum Beispiel in Word) oder nicht zugänglich: ${paths}. Schließen Sie sie und versuchen Sie es erneut.`
      : `Eine Datei ist in einer anderen Anwendung geöffnet (zum Beispiel in Word) oder nicht zugänglich: ${paths}. Schließen Sie sie und versuchen Sie es erneut.`,
};
const lockedFilesMessage = (error: unknown, locale: Language) => {
  if (!(error instanceof Error) || !error.message.startsWith(LOCKED_FILES_MESSAGE_PREFIX)) return undefined;
  // Zamknuté súbory sú v zozname vpredu; „; “ môže byť aj v názve súboru, preto rozhoduje kód za cestou.
  const list = error.message
    .slice(LOCKED_FILES_MESSAGE_PREFIX.length)
    .trim()
    .replace(/ \(\+\d+ more\)$/, "");
  const paths = [...list.matchAll(new RegExp(`(?:^|; )(.+?): ${LOCKED_FILE_CODE}(?=; |$)`, "g"))].map((match) => match[1] ?? "");
  return paths.length ? lockedFiles[locale](paths.join(", "), paths.length > 1) : undefined;
};
/** okf.config kancelárie v ANSI (PowerShell 5.1 `Set-Content`): názvy priečinkov z neho by boli poškodené. */
const officeConfigEncoding: Record<Language, string> = {
  sk: "Súbor okf.config kancelárie nie je uložený v UTF-8 (napríklad v ANSI z PowerShellu), takže priečinky z neho by mali poškodené názvy. Otvorte ho v Poznámkovom bloku, uložte ho s kódovaním UTF-8 a skúste to znova.",
  cs: "Soubor okf.config kanceláře není uložený v UTF-8 (například v ANSI z PowerShellu), takže složky z něj by měly poškozené názvy. Otevřete ho v Poznámkovém bloku, uložte ho s kódováním UTF-8 a zkuste to znovu.",
  en: "The office okf.config is not saved as UTF-8 (for example ANSI from PowerShell), so folders from it would get damaged names. Open it in Notepad, save it with UTF-8 encoding and try again.",
  de: "Die okf.config der Kanzlei ist nicht als UTF-8 gespeichert (zum Beispiel ANSI aus PowerShell), daher hätten Ordner daraus beschädigte Namen. Öffnen Sie sie im Editor, speichern Sie sie mit der Codierung UTF-8 und versuchen Sie es erneut.",
};
const officeConfigEncodingMessage = (error: unknown, locale: Language) =>
  error instanceof Error && error.message.startsWith(OFFICE_CONFIG_ENCODING_MESSAGE) ? officeConfigEncoding[locale] : undefined;
/** Vo vybranom priečinku je iná kancelária alebo karta (`conflicting_identity`). Spec #92: stop s vysvetlením. */
const nestedIdentity: Record<Language, (paths: string) => string> = {
  sk: (paths) => `Vo vybranom priečinku už je iná kancelária alebo iný klient: ${paths}. Taký priečinok sa nedá pripojiť ako jeden klient. Pripojte priamo priečinok tej kancelárie alebo vyberte iný priečinok.`,
  cs: (paths) => `Ve vybrané složce už je jiná kancelář nebo jiný klient: ${paths}. Takovou složku nelze připojit jako jednoho klienta. Připojte přímo složku té kanceláře nebo vyberte jinou složku.`,
  en: (paths) => `The selected folder already contains another office or another client: ${paths}. Such a folder cannot be added as a single client. Add that office folder directly or choose a different folder.`,
  de: (paths) => `Der gewählte Ordner enthält bereits eine andere Kanzlei oder einen anderen Mandanten: ${paths}. Ein solcher Ordner kann nicht als ein Mandant hinzugefügt werden. Fügen Sie direkt den Ordner dieser Kanzlei hinzu oder wählen Sie einen anderen Ordner.`,
};
const identityMessage = (error: unknown, locale: Language) => {
  if (!(error instanceof Error)) return undefined;
  const paths = [...error.message.matchAll(/(?:: |; )([^;]+?): conflicting_identity(?=; |$| \()/g)].map((match) => match[1] ?? "");
  return paths.length ? nestedIdentity[locale](paths.join(", ")) : undefined;
};
/**
 * Prehliadka priečinka narazila na limit (počet položiek, veľkosť, hĺbka) alebo sa v ňom nedala spoľahlivo
 * vyhľadať kancelária (`office_search_incomplete`). Typicky celý domovský priečinok (MČ 19. 10. 2026).
 */
const folderTooLarge: Record<Language, string> = {
  sk: "Priečinok je príliš veľký alebo má priveľa podpriečinkov. Vyberte priečinok konkrétneho klienta alebo kancelárie, nie celý domovský priečinok.",
  cs: "Složka je příliš velká nebo má příliš mnoho podsložek. Vyberte složku konkrétního klienta nebo kanceláře, ne celou domovskou složku.",
  en: "The folder is too large or has too many subfolders. Choose the folder of a specific client or office, not your whole home folder.",
  de: "Der Ordner ist zu groß oder hat zu viele Unterordner. Wählen Sie den Ordner eines bestimmten Mandanten oder der Kanzlei, nicht Ihren ganzen Benutzerordner.",
};
/** Kódy z `incompleteInspectionMessage` („<cesta>: <kód>“, koreň je „.“), ktoré znamenajú príliš veľký priečinok. */
const TOO_LARGE = /(?:^|: |; )[^;]*?: (?:office_search_incomplete|entry_limit|byte_limit|depth_limit)(?=; |$| \()/;
const folderTooLargeMessage = (error: unknown, locale: Language) =>
  error instanceof Error && TOO_LARGE.test(error.message) ? folderTooLarge[locale] : undefined;
/**
 * Vybraný klient nie je pripojený priečinok praxe alebo leží mimo nej (`chooseClient`, #168): nový prípad
 * u neho nevznikne; formulár ponúkne výber klienta (oprava onboardingu 19. 10. 2026).
 */
const CLIENT_UNAVAILABLE = "client_workspace_unavailable";
const clientUnavailable: Record<Language, string> = {
  sk: "Tento klient nie je pripojený v praxi alebo jeho priečinok chýba. Vyberte klienta nižšie.",
  cs: "Tento klient není v praxi připojený nebo jeho složka chybí. Vyberte klienta níže.",
  en: "This client is not connected in the practice or its folder is missing. Choose a client below.",
  de: "Dieser Mandant ist in der Kanzlei nicht verbunden oder sein Ordner fehlt. Wählen Sie unten einen Mandanten.",
};
/**
 * Celá prax nad priečinkom, ktorý už má priečinok kancelárie, ktorý sa nedá doplniť (holý Office, odkaz, dva
 * priečinky kancelárie), alebo nad časťou existujúcej kancelárie (N-14, 22. 10. 2026). Ďalší krok je tlačidlo
 * „Vybrať iný priečinok“ na tej istej obrazovke.
 */
const officeExists: Record<Language, string> = {
  sk: "V tomto priečinku už je priečinok kancelárie (Office alebo _kancelaria), ktorý sa nedá doplniť na kanceláriu LAWOSS. Pripojte priečinok v „Toto je“ ako klienta, alebo tlačidlom „Vybrať iný priečinok“ zvoľte priečinok, ktorý celú prax obsahuje.",
  cs: "V této složce už je složka kanceláře (Office nebo _kancelaria), kterou nelze doplnit na kancelář LAWOSS. Připojte složku v „Tohle je“ jako klienta, nebo tlačítkem „Vybrat jinou složku“ zvolte složku, která obsahuje celou praxi.",
  en: "This folder already has an office folder (Office or _kancelaria) that cannot be completed into a LAWOSS office. Add the folder as a client under “This is”, or use “Choose another folder” to pick the folder that contains the whole practice.",
  de: "Dieser Ordner enthält bereits einen Kanzleiordner (Office oder _kancelaria), der sich nicht zu einer LAWOSS-Kanzlei ergänzen lässt. Fügen Sie den Ordner unter „Das ist“ als Mandanten hinzu oder wählen Sie mit „Anderen Ordner wählen“ den Ordner, der die ganze Kanzlei enthält.",
};
const insideOffice: Record<Language, string> = {
  sk: "Tento priečinok je už súčasťou kancelárie LAWOSS. Tlačidlom „Vybrať iný priečinok“ zvoľte celú kanceláriu (priečinok, v ktorom je Office), nie jej časť.",
  cs: "Tato složka je už součástí kanceláře LAWOSS. Tlačítkem „Vybrat jinou složku“ zvolte celou kancelář (složku, ve které je Office), ne její část.",
  en: "This folder is already part of a LAWOSS office. Use “Choose another folder” to pick the whole office (the folder that contains Office), not a part of it.",
  de: "Dieser Ordner ist bereits Teil einer LAWOSS-Kanzlei. Wählen Sie mit „Anderen Ordner wählen“ die ganze Kanzlei (den Ordner mit Office), nicht einen Teil davon.",
};
const officeMessage = (error: unknown, locale: Language) => {
  if (!(error instanceof Error)) return undefined;
  if (error.message === OFFICE_EXISTS_MESSAGE) return officeExists[locale];
  return error.message.startsWith(INSIDE_OFFICE_MESSAGE_PREFIX) ? insideOffice[locale] : undefined;
};
/**
 * Klient vnútri iného klienta alebo priečinok s klientmi (N-A3-1, rozhodnutie MČ 23. 10. 2026). Server pošle id a meno
 * klienta len hostiteľskej appke v `details`; priečinok vnútri klienta už k nemu patrí, preto ponuka otvorí toho klienta.
 */
const NESTED_CLIENT_CODE = "onboarding_client_nested";
const CONTAINS_CLIENTS_CODE = "onboarding_client_contains_clients";
const nestedClient: Record<Language, { message: (client: string) => string; open: (client: string) => string }> = {
  sk: { message: (client) => `Tento priečinok patrí klientovi „${client}“. Klient nemôže byť vnútri iného klienta. Nič sa nezmenilo.`, open: (client) => `Otvoriť v klientovi ${client}` },
  cs: { message: (client) => `Tato složka patří klientovi „${client}“. Klient nemůže být uvnitř jiného klienta. Nic se nezměnilo.`, open: (client) => `Otevřít u klienta ${client}` },
  en: { message: (client) => `This folder belongs to the client “${client}”. A client cannot be inside another client. Nothing was changed.`, open: (client) => `Open in client ${client}` },
  de: { message: (client) => `Dieser Ordner gehört zum Mandanten „${client}“. Ein Mandant kann nicht in einem anderen Mandanten liegen. Es wurde nichts geändert.`, open: (client) => `Beim Mandanten ${client} öffnen` },
};
const containsClients: Record<Language, (clients: string) => string> = {
  sk: (clients) => `Tento priečinok obsahuje priečinky iných klientov (${clients}). Vyberte priečinok jedného klienta. Nič sa nezmenilo.`,
  cs: (clients) => `Tato složka obsahuje složky jiných klientů (${clients}). Vyberte složku jednoho klienta. Nic se nezměnilo.`,
  en: (clients) => `This folder holds the folders of other clients (${clients}). Choose the folder of one client. Nothing was changed.`,
  de: (clients) => `Dieser Ordner enthält die Ordner anderer Mandanten (${clients}). Wählen Sie den Ordner eines einzelnen Mandanten. Es wurde nichts geändert.`,
};
type ClientRef = { workspaceId: string; name: string };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const clientRefOf = (value: unknown): ClientRef | undefined =>
  isRecord(value) && typeof value.workspaceId === "string" && value.workspaceId && typeof value.name === "string" && value.name
    ? { workspaceId: value.workspaceId, name: value.name }
    : undefined;
const refusal = (error: unknown, code: string): Record<string, unknown> | undefined =>
  error instanceof Error && "code" in error && error.code === code && "details" in error && isRecord(error.details) ? error.details : undefined;
const nestedClientOf = (error: unknown): ClientRef | undefined => clientRefOf(refusal(error, NESTED_CLIENT_CODE));
const nestedClientMessage = (error: unknown, locale: Language) => {
  const outer = nestedClientOf(error);
  if (outer) return nestedClient[locale].message(outer.name);
  const details = refusal(error, CONTAINS_CLIENTS_CODE);
  const names = Array.isArray(details?.clients) ? details.clients.map(clientRefOf).filter((client) => client !== undefined).map((client) => client.name) : [];
  return names.length ? containsClients[locale](names.join(", ")) : undefined;
};
/**
 * Priečinok môže byť zaregistrovaný klient, ktorému len chýba priečinok (presunutá alebo premenovaná prax, N-A7-1).
 * Appka sa opýta, či ide o toho istého klienta: „Prepojiť“ zachová chaty a nastavenia, „Pridať ako nového“ ho pridá.
 * Pri zhode len podľa mena to povie výslovne (dvaja rôzni klienti môžu mať rovnaké meno).
 */
const movedClient: Record<Language, { message: (client: string, marker: boolean) => string; link: string; addNew: string }> = {
  sk: {
    message: (client, marker) => `Tento priečinok môže patriť klientovi „${client}“, ktorý už v LAWOSS je, len sa nenašiel jeho priečinok. ${marker ? "Priečinok nesie značku LAWOSS s pôvodným umiestnením tohto klienta." : "Zhoduje sa však len meno, môže ísť aj o iného klienta s rovnakým menom."} Je to ten istý klient?`,
    link: "Prepojiť", addNew: "Pridať ako nového",
  },
  cs: {
    message: (client, marker) => `Tato složka může patřit klientovi „${client}“, který už v LAWOSS je, jen se nenašla jeho složka. ${marker ? "Složka nese značku LAWOSS s původním umístěním tohoto klienta." : "Shoduje se však jen jméno, může jít i o jiného klienta se stejným jménem."} Je to tentýž klient?`,
    link: "Propojit", addNew: "Přidat jako nového",
  },
  en: {
    message: (client, marker) => `This folder may belong to the client “${client}”, who is already in LAWOSS but whose folder was not found. ${marker ? "The folder carries the LAWOSS mark with this client's original location." : "Only the name matches, so it may also be a different client with the same name."} Is it the same client?`,
    link: "Reconnect", addNew: "Add as new client",
  },
  de: {
    message: (client, marker) => `Dieser Ordner kann zum Mandanten „${client}“ gehören, der bereits in LAWOSS ist, dessen Ordner aber nicht gefunden wurde. ${marker ? "Der Ordner trägt die LAWOSS-Kennzeichnung mit dem ursprünglichen Speicherort dieses Mandanten." : "Es stimmt jedoch nur der Name überein; es kann auch ein anderer Mandant mit demselben Namen sein."} Ist es derselbe Mandant?`,
    link: "Neu verbinden", addNew: "Als neuen Mandanten hinzufügen",
  },
};
const movedClientMessage = (error: unknown, locale: Language) => {
  const choice = movedClientChoice(error);
  return choice ? movedClient[locale].message(choice.name, choice.evidence === "marker") : undefined;
};
/** Popisy volieb pri otázke „Je to ten istý klient?“. */
export const movedClientActions = (locale: Language): { link: string; addNew: string } => ({ link: movedClient[locale].link, addNew: movedClient[locale].addNew });
/** Ďalší krok pri odmietnutí: otvoriť klienta, ktorému priečinok patrí. Iné chyby ho nemajú. */
export function onboardingRefusalAction(error: unknown, locale: Language): { workspaceId: string; label: string } | undefined {
  const outer = nestedClientOf(error);
  return outer ? { workspaceId: outer.workspaceId, label: nestedClient[locale].open(outer.name) } : undefined;
}
/**
 * Chyba servera ako veta pre advokáta v jazyku rozhrania; neznáma chyba je všeobecná veta.
 * Surová správa (cesty, interné kódy) ide vždy len do konzoly. Spoločná pre pruh chyby aj hromadný krok.
 */
export function onboardingErrorMessage(error: unknown, locale: Language): string {
  console.warn("LAWOSS onboarding:", error);
  if (error instanceof Error && error.message === UNSAFE_FOLDER_NAME_MESSAGE) return unsafeFolderName[locale];
  if (error instanceof Error && error.message === FRESH_NOT_EMPTY) return foundText(locale)("freshNotEmpty");
  if (error instanceof Error && error.message === CLIENT_UNAVAILABLE) return clientUnavailable[locale];
  return nestedClientMessage(error, locale) ??
    movedClientMessage(error, locale) ??
    officeMessage(error, locale) ??
    lockedFilesMessage(error, locale) ??
    identityMessage(error, locale) ??
    folderTooLargeMessage(error, locale) ??
    officeConfigEncodingMessage(error, locale) ??
    folderNotFoundMessage(error, locale) ??
    canonicalPathRejection(error, locale) ??
    t("lawoss.onboarding.error_generic", locale);
}
