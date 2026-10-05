/** @jsxImportSource react */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, FileWarning, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/i18n/use-locale";
import { LANGUAGE_OPTIONS, setLanguagePreference, type Language } from "@/i18n";
import type {
  ClientType,
  DocumentLanguage,
  ExistingClientMode,
  MatterKind,
  OnboardingApi,
  OnboardingApplyResult,
  OnboardingPlanRequest,
  OnboardingPreview,
  OnboardingProfile,
  OnboardingStep,
} from "./api";
import {
  readPendingOnboarding,
  writePendingOnboarding,
  DEFAULT_ONBOARDING_PROGRESS,
  okfChoice,
  readOnboardingProgress,
  stepAfterAi,
  stepAfterOkfChoice,
  visibleOnboardingStep,
  visibleOnboardingSteps,
  writeOnboardingProgress,
} from "./onboarding-state";
import { OnboardingAiPanel } from "./ai-step";
import { visibleExistingClientModes } from "../../feature-flags";
import { clientTitleOf, resolveOpenClient, type OpenClientReader } from "../../okf/open-client";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { readActiveWorkspaceId } from "@/react-app/shell/session-memory";
import { UNSAFE_FOLDER_NAME_MESSAGE } from "../../../../../../lawoss/okf/src/onboarding/messages";
import { LawossWordmark } from "../../shell/wordmark";
import lawossMark from "../../../../../../lawoss/brand/lawoss-mark.svg";
import "./onboarding.css";

/** Jazyky rozhrania v poradí LAWOSS (SK, CS, EN, DE) s pôvodnými názvami namiesto kódov. */
const UI_LANGUAGE_ORDER: readonly Language[] = ["sk", "cs", "en", "de"];
const UI_LANGUAGES = UI_LANGUAGE_ORDER.flatMap((code) => LANGUAGE_OPTIONS.filter((option) => option.value === code));

/**
 * Priečinok klientov vedľa kancelárie: založenie kancelárie vytvorí `<rodič>/Office` a `<rodič>/Klienti`
 * (`client_path: "Klienti/*"`), takže krok klienta ho len predvyplní. Bez kancelárie ostane prázdny.
 */
export function clientsFolderOf(officeRoot: string | undefined): string {
  const root = officeRoot?.trim().replace(/[\\/]+$/, "");
  if (!root) return "";
  const cut = Math.max(root.lastIndexOf("/"), root.lastIndexOf("\\"));
  if (cut < 0) return "";
  return `${root.slice(0, cut)}${root[cut]}Klienti`;
}

const today = () => new Date().toISOString().slice(0, 10);
const documentLanguage = (language: Language): DocumentLanguage =>
  language === "de" ? "en" : language;
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.trim() ? error.message : fallback;
const text: Record<Language, Record<string, string>> = {
  en: {
    title: "Set up your practice",
    identity: "You and jurisdiction",
    okf: "Matter organisation",
    office: "Office",
    ai: "Data and AI",
    client: "First client",
    matter: "First matter",
    back: "Back",
    skip: "Skip for now",
    save: "Save and continue",
    preview: "Preview changes",
    apply: "Confirm and apply",
    lawyer: "Your name",
    jurisdiction: "Jurisdiction",
    language: "Interface language",
    new: "Create new",
    existing: "Connect existing",
    parent: "Parent folder",
    name: "Name",
    path: "Folder path",
    aiText:
      "The assistant answers through a model you connect in the AI settings. Onboarding does not create a separate AI configuration.",
    type: "Client type",
    company: "Company",
    jurisdictionSk: "Slovakia",
    jurisdictionCz: "Czech Republic",
    person: "Person",
    mode: "Connection mode",
    convert: "Convert safely",
    map: "Map without writing",
    trial_clone: "Trial clone",
    memory: "Relative existing memory path",
    anchor: "Identity text found in that file",
    area: "Area",
    subject: "Subject (optional)",
    withoutSubject: "Without subject",
    existingSubject: "Existing subject",
    newSubject: "Create a subject",
    kind: "Matter type",
    contentious: "Case (contentious)",
    non_contentious: "Matter (non-contentious)",
    noOffice:
      "The office is only a folder with settings and shared memory. You always work inside a specific client's folder.",
    mapHelp:
      "Mapping stays read-only. Both fields are required and must refer to existing client memory.",
    trial: "This is a trial clone. Confirm before creating work in it.",
    trialConfirm:
      "I understand this trial clone is not the original client folder.",
    changes: "Planned changes",
    officeConfirmed: "Office confirmed",
    done: "Your practice is ready. Add clients and matters later from the sidebar or Settings.",
    error: "This step could not be completed.",
  },
  sk: {
    title: "Nastavte svoju prax",
    identity: "Vy a jurisdikcia",
    okf: "Organizácia spisov",
    office: "Kancelária",
    ai: "Dáta a AI",
    client: "Prvý klient",
    matter: "Prvá vec",
    back: "Späť",
    skip: "Teraz preskočiť",
    save: "Uložiť a pokračovať",
    preview: "Náhľad zmien",
    apply: "Potvrdiť a vykonať",
    lawyer: "Vaše meno",
    jurisdiction: "Jurisdikcia",
    language: "Jazyk rozhrania",
    new: "Vytvoriť novú",
    existing: "Pripojiť existujúcu",
    parent: "Nadradený priečinok",
    name: "Názov",
    path: "Cesta k priečinku",
    aiText:
      "Asistent odpovedá cez model, ktorý pripojíte v nastaveniach AI. Onboarding nevytvára samostatnú konfiguráciu AI.",
    type: "Typ klienta",
    company: "Právnická osoba",
    jurisdictionSk: "Slovensko",
    jurisdictionCz: "Česko",
    person: "Fyzická osoba",
    mode: "Režim pripojenia",
    convert: "Bezpečne doplniť",
    map: "Mapovať bez zápisu",
    trial_clone: "Skúšobný klon",
    memory: "Relatívna cesta k existujúcej pamäti",
    anchor: "Text identity nájdený v tomto súbore",
    area: "Oblasť",
    subject: "Subjekt (voliteľné)",
    withoutSubject: "Bez subjektu",
    existingSubject: "Existujúci subjekt",
    newSubject: "Vytvoriť subjekt",
    kind: "Druh veci",
    contentious: "Spis (konanie)",
    non_contentious: "Vec (nesporová agenda)",
    noOffice:
      "Kancelária je len priečinok s nastaveniami a spoločnou pamäťou. Pracujete vždy v priečinku konkrétneho klienta.",
    mapHelp:
      "Mapovanie je iba na čítanie. Oba údaje sú povinné a musia odkazovať na existujúcu pamäť klienta.",
    trial: "Ide o skúšobný klon. Pred vytvorením práce ho potvrďte.",
    trialConfirm:
      "Rozumiem, že skúšobný klon nie je pôvodný priečinok klienta.",
    changes: "Plánované zmeny",
    officeConfirmed: "Kancelária je potvrdená",
    done: "Prax je pripravená. Klientov a veci pridáte neskôr z bočného panela alebo Nastavení.",
    error: "Tento krok sa nepodarilo dokončiť.",
  },
  cs: {
    title: "Nastavte svou praxi",
    identity: "Vy a jurisdikce",
    okf: "Organizace spisů",
    office: "Kancelář",
    ai: "Data a AI",
    client: "První klient",
    matter: "První věc",
    back: "Zpět",
    skip: "Nyní přeskočit",
    save: "Uložit a pokračovat",
    preview: "Náhled změn",
    apply: "Potvrdit a provést",
    lawyer: "Vaše jméno",
    jurisdiction: "Jurisdikce",
    language: "Jazyk rozhraní",
    new: "Vytvořit novou",
    existing: "Připojit existující",
    parent: "Nadřazená složka",
    name: "Název",
    path: "Cesta ke složce",
    aiText:
      "Asistent odpovídá přes model, který připojíte v nastavení AI. Onboarding nevytváří samostatnou konfiguraci AI.",
    type: "Typ klienta",
    company: "Právnická osoba",
    jurisdictionSk: "Slovensko",
    jurisdictionCz: "Česko",
    person: "Fyzická osoba",
    mode: "Režim připojení",
    convert: "Bezpečně doplnit",
    map: "Mapovat bez zápisu",
    trial_clone: "Zkušební klon",
    memory: "Relativní cesta k existující paměti",
    anchor: "Text identity nalezený v souboru",
    area: "Oblast",
    subject: "Subjekt (volitelné)",
    withoutSubject: "Bez subjektu",
    existingSubject: "Existující subjekt",
    newSubject: "Vytvořit subjekt",
    kind: "Druh věci",
    contentious: "Spis (řízení)",
    non_contentious: "Věc",
    noOffice:
      "Kancelář je jen složka s nastavením a společnou pamětí. Pracujete vždy ve složce konkrétního klienta.",
    mapHelp:
      "Mapování je pouze pro čtení. Oba údaje jsou povinné a musí odkazovat na existující paměť klienta.",
    trial: "Jde o zkušební klon. Před vytvořením práce jej potvrďte.",
    trialConfirm: "Rozumím, že zkušební klon není původní složka klienta.",
    changes: "Plánované změny",
    officeConfirmed: "Kancelář je potvrzena",
    done: "Praxe je připravena. Klienty a věci přidáte později z postranního panelu nebo Nastavení.",
    error: "Tento krok se nepodařilo dokončit.",
  },
  de: {
    title: "Richten Sie Ihre Praxis ein",
    identity: "Sie und die Jurisdiktion",
    okf: "Aktenorganisation",
    office: "Kanzlei",
    ai: "Daten und KI",
    client: "Erster Mandant",
    matter: "Erste Angelegenheit",
    back: "Zurück",
    skip: "Jetzt überspringen",
    save: "Speichern und weiter",
    preview: "Änderungen prüfen",
    apply: "Bestätigen und ausführen",
    lawyer: "Ihr Name",
    jurisdiction: "Jurisdiktion",
    language: "Sprache der Oberfläche",
    new: "Neu erstellen",
    existing: "Bestehende verbinden",
    parent: "Übergeordneter Ordner",
    name: "Name",
    path: "Ordnerpfad",
    aiText:
      "Der Assistent antwortet über ein Modell, das Sie in den KI-Einstellungen verbinden. Das Onboarding erstellt keine getrennte KI-Konfiguration.",
    type: "Mandantentyp",
    company: "Unternehmen",
    jurisdictionSk: "Slowakei",
    jurisdictionCz: "Tschechien",
    person: "Person",
    mode: "Verbindungsmodus",
    convert: "Sicher ergänzen",
    map: "Ohne Schreiben abbilden",
    trial_clone: "Testkopie",
    memory: "Relativer bestehender Speicherpfad",
    anchor: "In der Datei gefundener Identitätstext",
    area: "Bereich",
    subject: "Subjekt (optional)",
    withoutSubject: "Ohne Subjekt",
    existingSubject: "Bestehendes Subjekt",
    newSubject: "Subjekt erstellen",
    kind: "Art der Angelegenheit",
    contentious: "Akte (streitig)",
    non_contentious: "Angelegenheit (nicht streitig)",
    noOffice:
      "Die Kanzlei ist nur ein Ordner mit Einstellungen und gemeinsamem Gedächtnis. Sie arbeiten immer im Ordner eines bestimmten Mandanten.",
    mapHelp:
      "Die Abbildung bleibt schreibgeschützt. Beide Felder sind erforderlich und müssen auf den vorhandenen Mandantenspeicher verweisen.",
    trial:
      "Dies ist eine Testkopie. Bestätigen Sie sie vor dem Erstellen von Arbeit.",
    trialConfirm:
      "Ich verstehe, dass die Testkopie nicht der ursprüngliche Mandantenordner ist.",
    changes: "Geplante Änderungen",
    officeConfirmed: "Kanzlei bestätigt",
    done: "Ihre Kanzlei ist bereit. Mandanten und Angelegenheiten können Sie später über die Seitenleiste oder Einstellungen hinzufügen.",
    error: "Dieser Schritt konnte nicht abgeschlossen werden.",
  },
};
const unsafeFolderName: Record<Language, string> = {
  sk: "Názov priečinka nesmie byť prázdny, začínať bodkou, obsahovať znaky / \\ : < > \" | ? * ani mať viac ako 120 znakov. Bodky vnútri názvu, napríklad „s. r. o.“, sú v poriadku.",
  cs: "Název složky nesmí být prázdný, začínat tečkou, obsahovat znaky / \\ : < > \" | ? * ani mít více než 120 znaků. Tečky uvnitř názvu, například „s. r. o.“, jsou v pořádku.",
  en: "The folder name must not be empty, start with a dot, contain / \\ : < > \" | ? * or be longer than 120 characters. Dots inside the name, such as \"s. r. o.\", are fine.",
  de: "Der Ordnername darf nicht leer sein, nicht mit einem Punkt beginnen, keine Zeichen / \\ : < > \" | ? * enthalten und nicht länger als 120 Zeichen sein. Punkte im Namen, etwa „s. r. o.“, sind zulässig.",
};
/** Server errors in the UI language where the app knows them; other messages stay as sent. */
export const onboardingErrorMessage = (error: unknown, locale: Language) =>
  error instanceof Error && error.message === UNSAFE_FOLDER_NAME_MESSAGE
    ? unsafeFolderName[locale]
    : errorMessage(error, text[locale].error);
const field = (label: string, child: ReactNode) => (
  <label className="grid gap-1.5 text-sm font-medium">
    <span>{label}</span>
    {child}
  </label>
);
const DirectoryPickerContext = createContext<
  (() => Promise<string | null>) | null
>(null);
function PathInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const pick = useContext(DirectoryPickerContext);
  const locale = useLocale();
  const label = {
    en: "Choose folder",
    sk: "Vybrať priečinok",
    cs: "Vybrat složku",
    de: "Ordner wählen",
  }[locale];
  return (
    <span className="flex gap-2">
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          void pick?.().then((path) => {
            if (path) onChange(path);
          })
        }
      >
        {label}
      </Button>
    </span>
  );
}
const extraText: Record<Language, Record<string, string>> = {
  sk: {
    newMatter: "Nová vec",
    matterUnder: "Vec vznikne pod klientom",
    noClientYet: "Vyberte priečinok klienta, pod ktorým vec vznikne.",
    otherClient: "Iný klient (priečinok)",
    useClient: "Použiť tohto klienta",
    openClientLoading: "Zisťujem, ktorý klient je otvorený…",
    attachTitle: "Pripojiť existujúci priečinok klienta",
    original: "Pôvodný priečinok klienta",
    modeQuestion: "Čo sa stane s pôvodným priečinkom",
    trial_cloneHelp: "LAWOSS vytvorí kópiu priečinka a pracuje len v nej. Originál ostane nedotknutý: nič sa v ňom nezmení, nepribudne ani nezmaže. Vhodné na vyskúšanie.",
    convertHelp: "LAWOSS zapíše priamo do pôvodného priečinka: doplní chýbajúce súbory LAWOSS (kartu klienta, pokyny pre asistenta, pamäť). Vaše súbory neprepíše, nepresunie ani nezmaže.",
    convertConfirm: "Rozumiem, že LAWOSS zapíše do pôvodného priečinka.",
    cloneParent: "Kam uložiť kópiu",
    cloneTarget: "Kópia vznikne ako",
    trialPreview: "Vznikne kópia. Pôvodný priečinok ostane bez zmeny.",
    documentLanguage: "Jazyk dokumentov",
    soleTrader: "Fyzická osoba podnikateľ",
    other: "Iný",
    open: "Otvoriť LAWOSS",
    subjectPlan: "Náhľad subjektu",
    confirmClient: "Potvrdzujem, že vybraný priečinok patrí jednému klientovi.",
    recoverFinish: "Dokončiť prerušený zápis",
    recoverRollback: "Vrátiť prerušený zápis",
    pack: "Pri dokončení doplníme chýbajúce skills OKF pre klienta. Existujúce úpravy zachováme.",
    continue: "Pokračovať",
    workingFolder: "Pracovný priečinok (voliteľné)",
    workingFolderHelp: "LAWOSS bude pracovať v tomto priečinku. Nevytvorí v ňom priečinky ani súbory OKF.",
    finish: "Dokončiť",
  },
  cs: {
    newMatter: "Nová věc",
    matterUnder: "Věc vznikne pod klientem",
    noClientYet: "Vyberte složku klienta, pod kterým věc vznikne.",
    otherClient: "Jiný klient (složka)",
    useClient: "Použít tohoto klienta",
    openClientLoading: "Zjišťuji, který klient je otevřený…",
    attachTitle: "Připojit existující složku klienta",
    original: "Původní složka klienta",
    modeQuestion: "Co se stane s původní složkou",
    trial_cloneHelp: "LAWOSS vytvoří kopii složky a pracuje jen v ní. Originál zůstane nedotčený: nic se v něm nezmění, nepřibude ani nesmaže. Vhodné na vyzkoušení.",
    convertHelp: "LAWOSS zapíše přímo do původní složky: doplní chybějící soubory LAWOSS (kartu klienta, pokyny pro asistenta, paměť). Vaše soubory nepřepíše, nepřesune ani nesmaže.",
    convertConfirm: "Rozumím, že LAWOSS zapíše do původní složky.",
    cloneParent: "Kam uložit kopii",
    cloneTarget: "Kopie vznikne jako",
    trialPreview: "Vznikne kopie. Původní složka zůstane beze změny.",
    documentLanguage: "Jazyk dokumentů",
    soleTrader: "Fyzická osoba podnikatel",
    other: "Jiný",
    open: "Otevřít LAWOSS",
    subjectPlan: "Náhled subjektu",
    confirmClient: "Potvrzuji, že vybraná složka patří jednomu klientovi.",
    recoverFinish: "Dokončit přerušený zápis",
    recoverRollback: "Vrátit přerušený zápis",
    pack: "Při dokončení doplníme chybějící skills OKF pro klienta. Existující úpravy zachováme.",
    continue: "Pokračovat",
    workingFolder: "Pracovní složka (volitelné)",
    workingFolderHelp: "LAWOSS bude pracovat v této složce. Nevytvoří v ní složky ani soubory OKF.",
    finish: "Dokončit",
  },
  en: {
    newMatter: "New matter",
    matterUnder: "The matter will be created under client",
    noClientYet: "Choose the client folder the matter belongs to.",
    otherClient: "Another client (folder)",
    useClient: "Use this client",
    openClientLoading: "Finding the open client…",
    attachTitle: "Connect an existing client folder",
    original: "Original client folder",
    modeQuestion: "What happens to the original folder",
    trial_cloneHelp: "LAWOSS makes a copy of the folder and works only in the copy. The original stays untouched: nothing in it is changed, added or deleted. Good for trying things out.",
    convertHelp: "LAWOSS writes directly into the original folder: it adds the missing LAWOSS files (client card, instructions for the assistant, memory). Your files are not overwritten, moved or deleted.",
    convertConfirm: "I understand that LAWOSS writes into the original folder.",
    cloneParent: "Where to save the copy",
    cloneTarget: "The copy will be created as",
    trialPreview: "A copy will be created. The original folder stays unchanged.",
    documentLanguage: "Document language",
    soleTrader: "Sole trader",
    other: "Other",
    open: "Open LAWOSS",
    subjectPlan: "Preview subject",
    confirmClient: "I confirm this folder belongs to one client.",
    recoverFinish: "Finish interrupted changes",
    recoverRollback: "Roll back interrupted changes",
    pack: "Completion adds missing OKF skills for this client and preserves existing customizations.",
    continue: "Continue",
    workingFolder: "Working folder (optional)",
    workingFolderHelp: "LAWOSS will work in this folder. It creates no OKF folders or files in it.",
    finish: "Finish",
  },
  de: {
    newMatter: "Neue Angelegenheit",
    matterUnder: "Die Angelegenheit wird angelegt für den Mandanten",
    noClientYet: "Wählen Sie den Mandantenordner, zu dem die Angelegenheit gehört.",
    otherClient: "Anderer Mandant (Ordner)",
    useClient: "Diesen Mandanten verwenden",
    openClientLoading: "Geöffneter Mandant wird ermittelt…",
    attachTitle: "Bestehenden Mandantenordner verbinden",
    original: "Ursprünglicher Mandantenordner",
    modeQuestion: "Was mit dem Originalordner geschieht",
    trial_cloneHelp: "LAWOSS erstellt eine Kopie des Ordners und arbeitet nur in der Kopie. Das Original bleibt unberührt: darin wird nichts geändert, hinzugefügt oder gelöscht. Geeignet zum Ausprobieren.",
    convertHelp: "LAWOSS schreibt direkt in den Originalordner: Es ergänzt fehlende LAWOSS-Dateien (Mandantenkarte, Hinweise für den Assistenten, Gedächtnis). Ihre Dateien werden nicht überschrieben, verschoben oder gelöscht.",
    convertConfirm: "Ich verstehe, dass LAWOSS in den Originalordner schreibt.",
    cloneParent: "Speicherort der Kopie",
    cloneTarget: "Die Kopie entsteht als",
    trialPreview: "Es entsteht eine Kopie. Der Originalordner bleibt unverändert.",
    documentLanguage: "Dokumentsprache",
    soleTrader: "Einzelunternehmer",
    other: "Andere",
    open: "LAWOSS öffnen",
    subjectPlan: "Subjekt prüfen",
    confirmClient:
      "Ich bestätige, dass dieser Ordner zu einem Mandanten gehört.",
    recoverFinish: "Unterbrochene Änderungen abschließen",
    recoverRollback: "Unterbrochene Änderungen zurücknehmen",
    pack: "Beim Abschluss werden fehlende OKF-Skills ergänzt. Bestehende Anpassungen bleiben erhalten.",
    continue: "Weiter",
    workingFolder: "Arbeitsordner (optional)",
    workingFolderHelp: "LAWOSS arbeitet in diesem Ordner. Es legt darin keine OKF-Ordner oder -Dateien an.",
    finish: "Abschließen",
  },
};
/** Texty krokov onboardingu v jazyku rozhrania. */
export const welcomeText = (locale: Language) => (key: string): string =>
  key === "cancel"
    ? { en: "Cancel", sk: "Zrušiť", cs: "Zrušit", de: "Abbrechen" }[locale]
    : (extraText[locale][key] ?? text[locale][key]);
/** OKF notice, version `OKF_NOTICE_VERSION`. Changing the text needs a new version. */
type OkfNotice = {
  title: string;
  intro: string;
  points: readonly string[];
  use: string;
  notNow: string;
  acknowledge: string;
};
const okfNotice: Record<Language, OkfNotice> = {
  sk: {
    title: "Organizácia spisov (OKF)",
    intro:
      "LAWOSS môže viesť kanceláriu, klientov a veci v jednotnej štruktúre OKF. Sú to obyčajné priečinky a textové súbory na vašom počítači, ktoré si viete otvoriť aj bez LAWOSS.",
    points: [
      "Asistent číta a zapisuje pamäť veci: lehoty, zapojené subjekty, fakty a stav. Zápisy ostávajú v priečinku klienta.",
      "Ak používate model v cloude, časti spisu sa posielajú poskytovateľovi modelu ako súčasť otázky. Mlčanlivosť a zmluvu o spracúvaní údajov (DPA) s poskytovateľom máte vo svojej zodpovednosti.",
      "V alfa verzii pracujte len s vymyslenými alebo verejnými údajmi, nie so skutočnými spismi.",
      "OKF môžete zapnúť aj neskôr.",
    ],
    use: "Používať OKF",
    notNow: "Zatiaľ bez OKF",
    acknowledge: "Beriem na vedomie, ako OKF pracuje s údajmi spisu.",
  },
  cs: {
    title: "Organizace spisů (OKF)",
    intro:
      "LAWOSS může vést kancelář, klienty a věci v jednotné struktuře OKF. Jsou to obyčejné složky a textové soubory ve vašem počítači, které otevřete i bez LAWOSS.",
    points: [
      "Asistent čte a zapisuje paměť věci: lhůty, zapojené subjekty, fakta a stav. Zápisy zůstávají ve složce klienta.",
      "Pokud používáte model v cloudu, části spisu se posílají poskytovateli modelu jako součást dotazu. Mlčenlivost a smlouvu o zpracování údajů (DPA) s poskytovatelem máte ve své odpovědnosti.",
      "V alfa verzi pracujte jen s vymyšlenými nebo veřejnými údaji, ne se skutečnými spisy.",
      "OKF můžete zapnout i později.",
    ],
    use: "Používat OKF",
    notNow: "Zatím bez OKF",
    acknowledge: "Beru na vědomí, jak OKF pracuje s údaji spisu.",
  },
  en: {
    title: "Matter organisation (OKF)",
    intro:
      "LAWOSS can keep your office, clients and matters in one OKF structure. These are ordinary folders and text files on your computer that you can open without LAWOSS.",
    points: [
      "The assistant reads and writes matter memory: deadlines, involved parties, facts and status. Entries stay in the client folder.",
      "If you use a cloud model, parts of the matter are sent to the model provider as part of a question. Confidentiality and a data processing agreement (DPA) with the provider remain your responsibility.",
      "In the alpha, work only with invented or public data, not with real matters.",
      "You can turn OKF on later.",
    ],
    use: "Use OKF",
    notNow: "Not now",
    acknowledge: "I acknowledge how OKF handles matter data.",
  },
  de: {
    title: "Aktenorganisation (OKF)",
    intro:
      "LAWOSS kann Kanzlei, Mandanten und Angelegenheiten in einer einheitlichen OKF-Struktur führen. Das sind gewöhnliche Ordner und Textdateien auf Ihrem Computer, die Sie auch ohne LAWOSS öffnen können.",
    points: [
      "Der Assistent liest und schreibt das Gedächtnis der Angelegenheit: Fristen, beteiligte Personen und Stellen, Fakten und Stand. Einträge bleiben im Mandantenordner.",
      "Wenn Sie ein Cloud-Modell verwenden, werden Teile der Akte als Teil einer Frage an den Modellanbieter gesendet. Verschwiegenheit und ein Auftragsverarbeitungsvertrag (DPA) mit dem Anbieter liegen in Ihrer Verantwortung.",
      "Arbeiten Sie in der Alpha nur mit erfundenen oder öffentlichen Daten, nicht mit echten Akten.",
      "Sie können OKF auch später einschalten.",
    ],
    use: "OKF verwenden",
    notNow: "Vorerst ohne OKF",
    acknowledge: "Ich nehme zur Kenntnis, wie OKF mit Aktendaten umgeht.",
  },
};
/** Two equal choices, none preselected on first visit; enabling requires the acknowledgement. */
export function OkfChoiceStep({
  locale,
  initial,
  busy,
  continueLabel,
  onChoose,
}: {
  locale: Language;
  initial: boolean | undefined;
  busy: boolean;
  continueLabel: string;
  onChoose: (enabled: boolean) => Promise<void>;
}) {
  const notice = okfNotice[locale];
  const [choice, setChoice] = useState<boolean | undefined>(initial);
  const [acknowledged, setAcknowledged] = useState(false);
  const ready = choice === false || (choice === true && acknowledged);
  return (
    <>
      <h2 className="text-xl font-semibold">{notice.title}</h2>
      <p>{notice.intro}</p>
      <ul className="list-disc grid gap-2 pl-5 text-sm">
        {notice.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label={notice.title}>
        <Button
          type="button"
          variant={choice === true ? "default" : "outline"}
          aria-pressed={choice === true}
          onClick={() => setChoice(true)}
        >
          {notice.use}
        </Button>
        <Button
          type="button"
          variant={choice === false ? "default" : "outline"}
          aria-pressed={choice === false}
          onClick={() => setChoice(false)}
        >
          {notice.notNow}
        </Button>
      </div>
      {choice === true ? (
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          {notice.acknowledge}
        </label>
      ) : null}
      <Button
        disabled={busy || !ready}
        onClick={() => {
          if (choice !== undefined) void onChoose(choice);
        }}
      >
        {continueLabel}
      </Button>
    </>
  );
}
/** Optional working folder for the path without OKF; registered as a plain workspace. */
export function WorkingFolderStep({
  tr,
  busy,
  folder,
  onFolderChange,
  onFinish,
}: {
  tr: (key: string) => string;
  busy: boolean;
  folder: string;
  onFolderChange: (value: string) => void;
  onFinish: () => void;
}) {
  return (
    <>
      {field(tr("workingFolder"), <PathInput value={folder} onChange={onFolderChange} />)}
      <p className="text-sm text-muted-foreground">{tr("workingFolderHelp")}</p>
      <Button disabled={busy} onClick={onFinish}>
        {tr("finish")}
      </Button>
    </>
  );
}
function DocumentLanguageSelect({
  value,
  onChange,
}: {
  value: DocumentLanguage;
  onChange: (value: DocumentLanguage) => void;
}) {
  return (
    <select
      className="lw-onb-select"
      value={value}
      onChange={(event) => onChange(event.target.value as DocumentLanguage)}
    >
      <option value="sk">SK</option>
      <option value="cs">CS</option>
      <option value="en">EN</option>
    </select>
  );
}
/** Server client in the app; tests pass only the onboarding API. */
export type WelcomeApi = OnboardingApi & Partial<OpenClientReader & Pick<LegalworkServerClient, "listWorkspaces">>;
const sameFolder = (a: string | undefined, b: string | undefined) =>
  (a ?? "").replaceAll("\\", "/").replace(/\/+$/, "") === (b ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
/**
 * Nová vec patrí pod klienta práve otvoreného pracovného priestoru (alebo klienta veci, ktorá je otvorená),
 * inak pod posledného uloženého. Prepnutie ide cez ten istý zápis profilu ako tlačidlo „Použiť tohto
 * klienta“, takže server overí, že ide o úplného klienta; pri chybe ostane uložený klient.
 */
export async function preferOpenClient(
  api: WelcomeApi,
  profile: OnboardingProfile | null,
  activeId: string | null,
): Promise<OnboardingProfile | null> {
  if (profile?.okf?.enabled !== true || !api.listWorkspaces || !api.listWorkspaceDirectory || !api.readWorkspaceFile) return null;
  const reader: OpenClientReader = { listWorkspaceDirectory: api.listWorkspaceDirectory, readWorkspaceFile: api.readWorkspaceFile };
  try {
    const list = await api.listWorkspaces();
    const open = await resolveOpenClient(reader, list.items, activeId ?? list.activeId);
    if (!open || sameFolder(open.root, profile?.clientRoot)) return null;
    return await api.updateOnboardingProfile({ clientRoot: open.root, step: "matter" });
  } catch {
    return null;
  }
}
/** Meno klienta pre formulár veci; bez prístupu k pracovným priestorom názov priečinka. */
async function clientTitleFor(api: WelcomeApi, root: string): Promise<string> {
  const fallback = root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? root;
  if (!api.listWorkspaces || !api.listWorkspaceDirectory || !api.readWorkspaceFile) return fallback;
  const reader: OpenClientReader = { listWorkspaceDirectory: api.listWorkspaceDirectory, readWorkspaceFile: api.readWorkspaceFile };
  return api.listWorkspaces().then((list) => clientTitleOf(reader, list.items, root)).catch(() => fallback);
}
/** Completion details that are not an onboarding apply result. */
export type OnboardingCompletion = { workingFolder?: string };
type Props = {
  api: WelcomeApi;
  initialStep?: OnboardingStep;
  onComplete: (
    result?: OnboardingApplyResult,
    completion?: OnboardingCompletion,
  ) => void | Promise<void>;
  onOpenAiSettings: () => void;
  pickDirectory: () => Promise<string | null>;
  /** Krok klienta otvorený z tlačidla „Pripojiť existujúci priečinok klienta“. */
  attachExisting?: boolean;
};
export function LawossWelcomePage({
  api,
  initialStep,
  attachExisting = false,
  onComplete,
  onOpenAiSettings,
  pickDirectory,
}: Props) {
  const locale = useLocale();
  const tr = welcomeText(locale);
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [step, setStep] = useState<OnboardingStep>(initialStep ?? "identity");
  const [preview, setPreview] = useState<{
    request: Pick<OnboardingPlanRequest, "action">;
    value: OnboardingPreview;
  } | null>(null);
  const [completedResult, setCompletedResult] = useState<
    OnboardingApplyResult | undefined
  >();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workingFolder, setWorkingFolder] = useState("");
  // „+ Nová vec“ mimo prvého onboardingu: formulár počká, kým sa zistí otvorený klient.
  const [openClientPending, setOpenClientPending] = useState(initialStep === "matter");
  const [clientTitle, setClientTitle] = useState("");
  const completion = (): OnboardingCompletion | undefined =>
    workingFolder.trim() ? { workingFolder: workingFolder.trim() } : undefined;
  useEffect(() => {
    void api
      .onboardingStatus()
      .then(async (status) => {
        setProfile(status.profile);
        if (initialStep === "matter") {
          const preferred = await preferOpenClient(api, status.profile, readActiveWorkspaceId());
          if (preferred) setProfile(preferred);
          setOpenClientPending(false);
        }
        if (typeof window !== "undefined")
          setPreview(readPendingOnboarding(window.localStorage));
        const saved =
          typeof window === "undefined"
            ? DEFAULT_ONBOARDING_PROGRESS
            : readOnboardingProgress(window.localStorage);
        setStep(
          visibleOnboardingStep(
            initialStep ?? status.profile?.step ?? saved.step,
            status.profile?.okf?.enabled,
          ),
        );
      })
      .catch(() => {
        setOpenClientPending(false);
        setError(tr("error"));
      });
  }, [api, initialStep]);
  const savedClientRoot = profile?.clientRoot;
  useEffect(() => {
    let cancelled = false;
    setClientTitle("");
    if (savedClientRoot) void clientTitleFor(api, savedClientRoot).then((title) => { if (!cancelled) setClientTitle(title); });
    return () => { cancelled = true; };
  }, [api, savedClientRoot]);
  const move = async (
    next: OnboardingStep,
    patch: Pick<Partial<OnboardingProfile>, "okf"> = {},
  ) => {
    setBusy(true);
    setError(null);
    try {
      if (typeof window !== "undefined")
        writeOnboardingProgress(window.localStorage, {
          lane: "detailed",
          step: next,
        });
      const saved = await api.updateOnboardingProfile({ ...patch, step: next });
      setProfile(saved);
      setStep(next);
      if (next === "done") await onComplete(completedResult, completion());
    } catch (reason) {
      setError(onboardingErrorMessage(reason, locale));
    } finally {
      setBusy(false);
    }
  };
  // Náhľad zmien sa po vytvorení posunie do zorného poľa, aby jeho potvrdenie nebolo pod okrajom okna.
  const previewSection = useRef<HTMLElement | null>(null);
  // Nový krok začína hore; inak by po dlhom náhľade ostal posunutý a jeho nadpis by nebolo vidieť.
  const scrollArea = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollArea.current?.scrollTo?.({ top: 0 });
  }, [step]);
  useEffect(() => {
    if (!preview) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    previewSection.current?.scrollIntoView?.({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }, [preview]);
  const plan = async (request: OnboardingPlanRequest) => {
    setBusy(true);
    setError(null);
    try {
      const pending = { request, value: await api.planOnboarding(request) };
      setPreview(pending);
      writePendingOnboarding(window.localStorage, pending);
    } catch (reason) {
      setError(onboardingErrorMessage(reason, locale));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await api.applyOnboarding({
        id: preview.value.id,
        fingerprint: preview.value.fingerprint,
        confirm: true,
      });
      const roots = {
        ...(preview.request.action === "office" && result.root
          ? { officeRoot: result.root }
          : {}),
        ...(result.clientRoot ? { clientRoot: result.clientRoot } : {}),
        ...(preview.request.action === "subject" && result.root
          ? { subjectRoot: result.root }
          : {}),
        ...(preview.request.action === "matter"
          ? { subjectRoot: result.subjectRoot ?? null }
          : {}),
        ...(result.matterRoot ? { matterRoot: result.matterRoot } : {}),
        ...(result.trial === true
          ? { trial: true }
          : preview.request.action === "existing"
            ? { trial: false }
            : {}),
      };
      const next =
        preview.request.action === "office"
          ? "ai"
          : preview.request.action === "matter"
            ? "done"
            : "matter";
      setCompletedResult(result);
      setProfile(await api.updateOnboardingProfile({ ...roots, step: next }));
      setStep(next);
      setPreview(null);
      writePendingOnboarding(window.localStorage, null);
      if (next === "done") await onComplete(result);
    } catch (reason) {
      setError(onboardingErrorMessage(reason, locale));
    } finally {
      setBusy(false);
    }
  };
  const recover = async (action: "finish" | "rollback") => {
    if (!preview || !api.recoverOnboarding) return;
    setBusy(true);
    setError(null);
    try {
      await api.recoverOnboarding({
        id: preview.value.id,
        fingerprint: preview.value.fingerprint,
        confirm: true,
        action,
      });
      if (action === "finish") await apply();
      else {
        setPreview(null);
        writePendingOnboarding(window.localStorage, null);
      }
    } catch (reason) {
      setError(onboardingErrorMessage(reason, locale));
    } finally {
      setBusy(false);
    }
  };
  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      await onComplete(completedResult, completion());
    } catch (reason) {
      setError(onboardingErrorMessage(reason, locale));
    } finally {
      setBusy(false);
    }
  };
  const okfEnabled = profile?.okf?.enabled;
  const steps = visibleOnboardingSteps(okfEnabled);
  const idx = steps.indexOf(step);
  const base = profile ?? {
    version: 1,
    lawyerName: "",
    jurisdiction: "sk",
    language: locale,
  };
  return (
    <DirectoryPickerContext.Provider value={pickDirectory}>
      {/* Koreň appky má overflow: hidden; bez vlastnej posúvateľnej oblasti by náhľad zmien a jeho
          potvrdenie v nižšom okne neboli dosiahnuteľné (D1 na zabalenej appke). */}
      <div ref={scrollArea} className="lw-onb h-screen overflow-y-auto" data-lawoss-onboarding-scroll>
      <main
        className="lw-onb-main mx-auto min-h-full max-w-3xl px-6 py-12"
        data-lawoss-onboarding-step={step}
      >
        <header>
          <p className="lw-onb-brand">
            <img src={lawossMark} alt="" aria-hidden />
            <LawossWordmark className="lw-onb-wordmark" />
            <span className="sr-only">LAWOSS</span>
          </p>
          <h1 className="lw-onb-title">{tr("title")}</h1>
          <ol
            className="lw-onb-steps"
            style={{
              gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
            }}
          >
            {steps.map((item, i) => (
              <li
                key={item}
                data-state={i < idx ? "done" : i === idx ? "current" : "next"}
                aria-current={i === idx ? "step" : undefined}
              >
                <span className="lw-onb-step-bar" />
                <span className="lw-onb-step-label">
                  {i + 1}. {tr(item)}
                </span>
              </li>
            ))}
          </ol>
        </header>
        {error ? (
          <p
            role="alert"
            className="lw-status err"
          >
            {error}
          </p>
        ) : null}
        <section className="lw-onb-panel grid gap-5">
          {step === "identity" ? (
            <Identity
              base={base}
              locale={locale}
              tr={tr}
              busy={busy}
              onSave={async (next) => {
                setBusy(true);
                setError(null);
                try {
                  setLanguagePreference(next.language);
                  setProfile(await api.updateOnboardingProfile(next));
                  await move("okf");
                } catch (reason) {
                  setError(onboardingErrorMessage(reason, locale));
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : null}
          {step === "okf" ? (
            <OkfChoiceStep
              key={String(okfEnabled)}
              locale={locale}
              initial={okfEnabled}
              busy={busy}
              continueLabel={tr("continue")}
              onChoose={(enabled) =>
                move(stepAfterOkfChoice(enabled, initialStep), {
                  okf: okfChoice(enabled, new Date()),
                })
              }
            />
          ) : null}
          {step === "office" ? (
            <Office
              base={base}
              api={api}
              tr={tr}
              busy={busy}
              onPlan={plan}
              onExisting={async (officeRoot) => {
                try {
                  setProfile(await api.updateOnboardingProfile({ officeRoot }));
                  await move("ai");
                } catch (reason) {
                  setError(onboardingErrorMessage(reason, locale));
                }
              }}
            />
          ) : null}
          {step === "ai" ? (
            <>
              <h2 className="text-xl font-semibold">{tr("ai")}</h2>
              <p className="text-muted-foreground">{tr("aiText")}</p>
              <OnboardingAiPanel
                locale={locale}
                busy={busy}
                onOpenAiSettings={onOpenAiSettings}
                onContinue={
                  okfEnabled === false
                    ? undefined
                    : () => void move(stepAfterAi(okfEnabled))
                }
              />
              {okfEnabled === false ? (
                <WorkingFolderStep
                  tr={tr}
                  busy={busy}
                  folder={workingFolder}
                  onFolderChange={setWorkingFolder}
                  onFinish={() => void move("done")}
                />
              ) : null}
            </>
          ) : null}
          {step === "client" ? (
            <Client
              base={base}
              locale={locale}
              tr={tr}
              busy={busy}
              onPlan={plan}
              initialExisting={attachExisting && initialStep === "client"}
            />
          ) : null}
          {step === "matter" && openClientPending ? (
            <p role="status">{tr("openClientLoading")}</p>
          ) : null}
          {step === "matter" && !openClientPending ? (
            <Matter
              title={initialStep === "matter" ? tr("newMatter") : tr("matter")}
              clientTitle={clientTitle}
              base={base}
              locale={locale}
              tr={tr}
              busy={busy}
              onPlan={plan}
              onClientChange={async (clientRoot) => {
                setBusy(true);
                setError(null);
                try {
                  setProfile(
                    await api.updateOnboardingProfile({
                      clientRoot,
                      step: "matter",
                    }),
                  );
                } catch (reason) {
                  setError(onboardingErrorMessage(reason, locale));
                } finally {
                  setBusy(false);
                }
              }}
              onSubjectChange={async (subjectRoot) => {
                setBusy(true);
                setError(null);
                try {
                  setProfile(
                    await api.updateOnboardingProfile({
                      subjectRoot,
                      step: "matter",
                    }),
                  );
                } catch (reason) {
                  setError(onboardingErrorMessage(reason, locale));
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : null}
          {step === "done" ? (
            <>
              <Check className="lw-onb-done size-8" />
              <p>{tr("done")}</p>
              <Button disabled={busy} onClick={() => void complete()}>
                {tr("open")}
              </Button>
            </>
          ) : null}
        </section>
        {preview ? (
          <section ref={previewSection} className="lw-onb-panel lw-onb-preview" data-lawoss-onboarding-preview>
            <h2 className="flex gap-2 font-semibold">
              <ShieldCheck className="size-5" />
              {tr("changes")}
            </h2>
            {preview.value.preview.label ? (
              <p className="mt-3 break-all text-sm">
                {preview.value.preview.label}
              </p>
            ) : null}
            {preview.value.preview.officeMemoryRoot ? (
              <p className="mt-3 break-all text-sm">
                {
                  {
                    sk: "Povoliť pamäť kancelárie",
                    cs: "Povolit paměť kanceláře",
                    en: "Allow office memory",
                    de: "Kanzleispeicher erlauben",
                  }[locale]
                }
                : {preview.value.preview.officeMemoryRoot}
              </p>
            ) : null}
            <ul className="mt-3 list-disc pl-5 text-sm">
              {(preview.value.preview.operations ?? []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {(preview.value.preview.warnings ?? []).map((item) => (
              <p key={item} className="mt-2 text-sm text-[var(--lw-warning)]">
                {item === "trial_clone" ? tr("trialPreview") : item}
              </p>
            ))}
            <div className="mt-5 flex gap-2">
              <Button disabled={busy} onClick={() => void apply()}>
                {tr("apply")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  writePendingOnboarding(window.localStorage, null);
                }}
              >
                {tr("cancel")}
              </Button>
            </div>
            {error && api.recoverOnboarding ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void recover("finish")}
                >
                  {tr("recoverFinish")}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void recover("rollback")}
                >
                  {tr("recoverRollback")}
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}
        {step !== "identity" && step !== "done" ? (
          <footer className="mt-8 flex justify-between">
            <Button
              variant="ghost"
              onClick={() => void move(steps[Math.max(0, idx - 1)])}
            >
              {tr("back")}
            </Button>
            {step === "client" || step === "matter" ? (
              <Button
                variant="ghost"
                onClick={() => void move(step === "client" ? "matter" : "done")}
              >
                {tr("skip")}
              </Button>
            ) : null}
          </footer>
        ) : null}
      </main>
      </div>
    </DirectoryPickerContext.Provider>
  );
}
function Identity({
  base,
  locale,
  tr,
  busy,
  onSave,
}: {
  base: OnboardingProfile;
  locale: Language;
  tr: (key: string) => string;
  busy: boolean;
  onSave: (
    value: Pick<OnboardingProfile, "lawyerName" | "jurisdiction" | "language">,
  ) => Promise<void>;
}) {
  const [name, setName] = useState(base.lawyerName);
  const [jurisdiction, setJurisdiction] = useState(base.jurisdiction);
  const [language, setLanguage] = useState<Language>(base.language ?? locale);
  return (
    <>
      {field(
        tr("lawyer"),
        <Input value={name} onChange={(e) => setName(e.target.value)} />,
      )}
      {field(
        tr("jurisdiction"),
        <select
          className="lw-onb-select"
          value={jurisdiction}
          onChange={(e) => setJurisdiction(e.target.value as "sk" | "cz")}
        >
          <option value="sk">{tr("jurisdictionSk")}</option>
          <option value="cz">{tr("jurisdictionCz")}</option>
        </select>,
      )}
      {field(
        tr("language"),
        <select
          className="lw-onb-select"
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
        >
          {UI_LANGUAGES.map((x) => (
            <option key={x.value} value={x.value}>{x.nativeName}</option>
          ))}
        </select>,
      )}
      <Button
        disabled={busy || !name.trim()}
        onClick={() =>
          void onSave({ lawyerName: name, jurisdiction, language })
        }
      >
        {tr("save")}
      </Button>
    </>
  );
}
function Office({
  base,
  api,
  tr,
  busy,
  onPlan,
  onExisting,
}: {
  base: OnboardingProfile;
  api: OnboardingApi;
  tr: (key: string) => string;
  busy: boolean;
  onPlan: (r: OnboardingPlanRequest) => Promise<void>;
  onExisting: (root: string) => Promise<void>;
}) {
  const [existing, setExisting] = useState(false);
  const [parent, setParent] = useState("");
  const [title, setTitle] = useState("Office");
  const [status, setStatus] = useState("");
  const [officeConfirmed, setOfficeConfirmed] = useState(false);
  const [docLanguage, setDocLanguage] = useState<DocumentLanguage>(
    documentLanguage(base.language),
  );
  return (
    <>
      <h2 className="text-xl font-semibold">{tr("office")}</h2>
      <p className="text-sm text-muted-foreground">{tr("noOffice")}</p>
      <p className="text-sm text-muted-foreground">{tr("pack")}</p>
      <div className="flex gap-2">
        <Button
          variant={!existing ? "default" : "outline"}
          onClick={() => setExisting(false)}
        >
          {tr("new")}
        </Button>
        <Button
          variant={existing ? "default" : "outline"}
          onClick={() => setExisting(true)}
        >
          {tr("existing")}
        </Button>
      </div>
      {field(
        existing ? tr("path") : tr("parent"),
        <PathInput
          value={parent}
          onChange={(value) => {
            setParent(value);
            setOfficeConfirmed(false);
            setStatus("");
          }}
        />,
      )}
      {!existing ? (
        <>
          {field(
            tr("documentLanguage"),
            <DocumentLanguageSelect
              value={docLanguage}
              onChange={setDocLanguage}
            />,
          )}
          {field(
            tr("name"),
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />,
          )}
          <Button
            disabled={busy || !parent || !title}
            onClick={() =>
              void onPlan({
                action: "office",
                parent,
                title,
                jurisdiction: base.jurisdiction,
                language: docLanguage,
                lawyerName: base.lawyerName,
              })
            }
          >
            {tr("preview")}
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="outline"
            disabled={busy || !parent}
            onClick={() =>
              void api
                .classifyOnboarding({ root: parent })
                .then((result) => {
                  const confirmed =
                    result.level === "office" && result.complete === true;
                  setOfficeConfirmed(confirmed);
                  setStatus(
                    confirmed
                      ? tr("officeConfirmed")
                      : (result.message ??
                          result.issues
                            ?.map((issue) => `${issue.path}: ${issue.code}`)
                            .join(", ") ??
                          result.level),
                  );
                })
                .catch((reason: unknown) => {
                  setOfficeConfirmed(false);
                  setStatus(
                    reason instanceof Error ? reason.message : tr("error"),
                  );
                })
            }
          >
            {tr("preview")}
          </Button>
          {status ? <p role="status">{status}</p> : null}
          <Button
            disabled={busy || !parent || !officeConfirmed}
            onClick={() => void onExisting(parent)}
          >
            {tr("save")}
          </Button>
        </>
      )}
    </>
  );
}
/** Rodičovský priečinok cesty; kópia skúšobného klonu vznikne predvolene vedľa originálu. */
export function parentFolderOf(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut > 0 ? trimmed.slice(0, cut) : "";
}
const folderName = (path: string) => path.trim().replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
/** Názov kópie tak, ako ho vytvorí server (`planExistingClient`). */
export const trialCloneName = (original: string, date: string) => `${folderName(original) || "client"} (trial ${date})`;
/** Režimy pripojenia v poradí ponuky; skúšobný klon je prvý a predvolený, mapovanie skryje alfa prepínač. */
const EXISTING_MODES = visibleExistingClientModes(["trial_clone", "convert", "map"] as const);
export function Client({
  base,
  locale,
  tr,
  busy,
  onPlan,
  initialExisting = false,
}: {
  base: OnboardingProfile;
  locale: Language;
  tr: (key: string) => string;
  busy: boolean;
  onPlan: (r: OnboardingPlanRequest) => Promise<void>;
  initialExisting?: boolean;
}) {
  const [existing, setExisting] = useState(initialExisting);
  const [value, setValue] = useState("");
  const [clientParent, setClientParent] = useState(() => clientsFolderOf(base.officeRoot));
  const [docLanguage, setDocLanguage] = useState<DocumentLanguage>(
    documentLanguage(locale),
  );
  const [confirmedClient, setConfirmedClient] = useState(false);
  const [confirmedWrite, setConfirmedWrite] = useState(false);
  const [type, setType] = useState<ClientType>("po");
  const [mode, setMode] = useState<ExistingClientMode>(EXISTING_MODES[0] ?? "trial_clone");
  const [memoryPath, setMemoryPath] = useState("");
  const [identityAnchor, setIdentityAnchor] = useState("");
  // Kým ho advokát nezmení, kópia vznikne vedľa vybraného originálu.
  const [cloneParentChoice, setCloneParent] = useState<string | null>(null);
  const cloneParent = cloneParentChoice ?? parentFolderOf(value);
  const request = (): OnboardingPlanRequest =>
    existing
      ? {
          action: "existing",
          root: value,
          mode,
          title: folderName(value) || "Client",
          clientType: type,
          jurisdiction: base.jurisdiction,
          date: today(),
          language: docLanguage,
          confirmUnknownClient: confirmedClient,
          ...(mode === "map" ? { memoryPath, identityAnchor } : {}),
          ...(mode === "trial_clone" ? { cloneParent } : {}),
        }
      : {
          action: "client",
          parent: clientParent,
          name: value,
          title: value,
          clientType: type,
          jurisdiction: base.jurisdiction,
          date: today(),
          language: docLanguage,
        };
  const valid =
    value.trim() &&
    (existing || clientParent.trim()) &&
    (mode !== "map" || (memoryPath.trim() && identityAnchor.trim())) &&
    (mode !== "trial_clone" || cloneParent.trim()) &&
    (!existing || mode !== "convert" || confirmedWrite) &&
    (!existing || mode === "map" || confirmedClient);
  return (
    <>
      <h2 className="text-xl font-semibold">{existing ? tr("attachTitle") : tr("client")}</h2>
      <div className="flex gap-2">
        <Button
          variant={!existing ? "default" : "outline"}
          onClick={() => setExisting(false)}
        >
          {tr("new")}
        </Button>
        <Button
          variant={existing ? "default" : "outline"}
          onClick={() => setExisting(true)}
        >
          {tr("existing")}
        </Button>
      </div>
      {field(
        existing ? tr("original") : tr("name"),
        existing ? (
          <PathInput value={value} onChange={setValue} />
        ) : (
          <Input value={value} onChange={(e) => setValue(e.target.value)} />
        ),
      )}
      {!existing
        ? field(
            tr("parent"),
            <PathInput value={clientParent} onChange={setClientParent} />,
          )
        : null}
      {existing ? (
        <fieldset className="grid gap-2" data-lawoss-existing-modes>
          <legend className="mb-1.5 text-sm font-medium">{tr("modeQuestion")}</legend>
          {EXISTING_MODES.map((x) => (
            <label key={x} className="lw-onb-inset flex gap-3 text-sm" data-mode={x}>
              <input
                type="radio"
                name="lawoss-existing-mode"
                value={x}
                checked={mode === x}
                onChange={() => setMode(x)}
              />
              <span className="grid gap-1">
                <span className="font-medium">{tr(x)}</span>
                <span className="text-muted-foreground">{tr(`${x}Help`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {existing && mode === "trial_clone" ? (
        <div className="grid gap-1.5">
          {field(
            tr("cloneParent"),
            <PathInput value={cloneParent} onChange={setCloneParent} />,
          )}
          {value.trim() && cloneParent.trim() ? (
            <p className="break-all text-sm text-muted-foreground" data-lawoss-clone-target>
              {tr("cloneTarget")}: {cloneParent.replace(/[\\/]+$/, "")}/{trialCloneName(value, today())}
            </p>
          ) : null}
        </div>
      ) : null}
      {existing && mode === "convert" ? (
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmedWrite}
            onChange={(event) => setConfirmedWrite(event.target.checked)}
          />
          {tr("convertConfirm")}
        </label>
      ) : null}
      {existing && mode === "map" ? (
        <div className="lw-onb-inset grid gap-3">
          <p className="text-sm text-muted-foreground">{tr("mapHelp")}</p>
          {field(
            tr("memory"),
            <Input
              value={memoryPath}
              onChange={(e) => setMemoryPath(e.target.value)}
            />,
          )}
          {field(
            tr("anchor"),
            <Input
              value={identityAnchor}
              onChange={(e) => setIdentityAnchor(e.target.value)}
            />,
          )}
        </div>
      ) : null}
      {field(
        tr("documentLanguage"),
        <DocumentLanguageSelect
          value={docLanguage}
          onChange={setDocLanguage}
        />,
      )}
      {existing && mode !== "map" ? (
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmedClient}
            onChange={(event) => setConfirmedClient(event.target.checked)}
          />
          {tr("confirmClient")}
        </label>
      ) : null}
      {field(
        tr("type"),
        <select
          className="lw-onb-select"
          value={type}
          onChange={(e) => setType(e.target.value as ClientType)}
        >
          <option value="po">{tr("company")}</option>
          <option value="fo">{tr("person")}</option>
          <option value="fo-podnikatel">{tr("soleTrader")}</option>
          <option value="iny">{tr("other")}</option>
        </select>,
      )}
      <Button disabled={busy || !valid} onClick={() => void onPlan(request())}>
        {tr("preview")}
      </Button>
    </>
  );
}
export function Matter({
  title: heading,
  clientTitle,
  base,
  locale,
  tr,
  busy,
  onPlan,
  onClientChange,
  onSubjectChange,
}: {
  title: string;
  clientTitle: string;
  base: OnboardingProfile;
  locale: Language;
  tr: (key: string) => string;
  busy: boolean;
  onPlan: (r: OnboardingPlanRequest) => Promise<void>;
  onClientChange: (clientRoot: string) => Promise<void>;
  onSubjectChange: (subjectRoot: string | null) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("General");
  const [subject, setSubject] = useState("");
  const [kind, setKind] = useState<MatterKind>("contentious");
  const [documentLanguage, setDocumentLanguage] = useState<DocumentLanguage>(
    documentLanguageForUi(locale),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [selectedClientPath, setSelectedClientPath] = useState(
    base.clientRoot ?? "",
  );
  const [subjectMode, setSubjectMode] = useState<"none" | "existing" | "new">(
    base.subjectRoot ? "existing" : "none",
  );
  const [selectedSubjectRoot, setSelectedSubjectRoot] = useState(
    base.subjectRoot ?? "",
  );
  const [observedSubjectRoot, setObservedSubjectRoot] = useState(
    base.subjectRoot ?? "",
  );
  const [subjectTouched, setSubjectTouched] = useState(false);
  const root = base.clientRoot ?? "";
  const trial = base.trial === true;
  const parent =
    subjectMode === "existing" && selectedSubjectRoot
      ? selectedSubjectRoot
      : root;
  const needsSubject = subjectMode === "new" && subject.trim();
  useEffect(() => {
    if (root && !selectedClientPath) setSelectedClientPath(root);
  }, [root, selectedClientPath]);
  useEffect(() => {
    if (!base.subjectRoot || base.subjectRoot === observedSubjectRoot) return;
    setObservedSubjectRoot(base.subjectRoot);
    if (!subjectTouched || subjectMode === "new") {
      setSelectedSubjectRoot(base.subjectRoot);
      setSubjectMode("existing");
      setSubjectTouched(true);
    }
  }, [base.subjectRoot, observedSubjectRoot, subjectMode, subjectTouched]);
  const chooseSubjectMode = (mode: "none" | "existing" | "new") => {
    setSubjectMode(mode);
    setSubjectTouched(true);
    if (mode === "none" || mode === "new") {
      setSelectedSubjectRoot("");
      if (mode === "none") setSubject("");
      void onSubjectChange(null);
    }
  };
  return (
    <>
      <h2 className="text-xl font-semibold">{heading}</h2>
      <div className="lw-onb-inset grid gap-1" data-lawoss-matter-client>
        {root ? (
          <>
            <p className="text-sm text-muted-foreground">{tr("matterUnder")}</p>
            <p className="text-lg font-semibold">{clientTitle || root}</p>
            <p className="break-all text-xs text-muted-foreground">{root}</p>
          </>
        ) : (
          <p className="text-sm">{tr("noClientYet")}</p>
        )}
      </div>
      {field(
        root ? tr("otherClient") : tr("client"),
        <div className="grid gap-2">
          <PathInput
            value={selectedClientPath}
            onChange={setSelectedClientPath}
          />
          <Button
            type="button"
            variant="outline"
            disabled={
              busy || !selectedClientPath.trim() || selectedClientPath === root
            }
            onClick={() => {
              setSubject("");
              setSubjectMode("none");
              setSelectedSubjectRoot("");
              setSubjectTouched(true);
              setTitle("");
              setConfirmed(false);
              void onClientChange(selectedClientPath);
            }}
          >
            {tr("useClient")}
          </Button>
        </div>,
      )}
      {trial ? (
        <div className="lw-status warn">
          <FileWarning className="mb-2 size-5" />
          <p>{tr("trial")}</p>
          <label className="mt-3 flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {tr("trialConfirm")}
          </label>
        </div>
      ) : null}
      {field(
        tr("name"),
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />,
      )}
      {field(
        tr("area"),
        <Input value={area} onChange={(e) => setArea(e.target.value)} />,
      )}
      {field(
        tr("subject"),
        <div className="grid gap-2">
          <select
            className="lw-onb-select"
            value={subjectMode}
            onChange={(event) =>
              chooseSubjectMode(
                event.target.value as "none" | "existing" | "new",
              )
            }
          >
            <option value="none">{tr("withoutSubject")}</option>
            {selectedSubjectRoot ? (
              <option value="existing">
                {tr("existingSubject")}: {selectedSubjectRoot}
              </option>
            ) : null}
            <option value="new">{tr("newSubject")}</option>
          </select>
          {subjectMode === "new" ? (
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          ) : null}
        </div>,
      )}
      {field(
        tr("documentLanguage"),
        <select
          className="lw-onb-select"
          value={documentLanguage}
          onChange={(e) =>
            setDocumentLanguage(e.target.value as DocumentLanguage)
          }
        >
          <option value="sk">SK</option>
          <option value="cs">CS</option>
          <option value="en">EN</option>
        </select>,
      )}
      {field(
        tr("kind"),
        <select
          className="lw-onb-select"
          value={kind}
          onChange={(e) => setKind(e.target.value as MatterKind)}
        >
          <option value="contentious">{tr("contentious")}</option>
          <option value="non_contentious">{tr("non_contentious")}</option>
        </select>,
      )}
      {needsSubject ? (
        <Button
          disabled={busy || !root}
          onClick={() =>
            void onPlan({
              action: "subject",
              clientRoot: root,
              name: subject,
              title: subject,
            })
          }
        >
          {tr("subjectPlan")}
        </Button>
      ) : (
        <Button
          disabled={busy || !root || !title || (trial && !confirmed)}
          onClick={() =>
            void onPlan({
              action: "matter",
              clientRoot: root,
              parent,
              title,
              date: today(),
              kind,
              area,
              jurisdiction: base.jurisdiction,
              ...(subjectMode === "existing" && selectedSubjectRoot
                ? { subject: selectedSubjectRoot }
                : {}),
              language: documentLanguage,
            })
          }
        >
          {tr("preview")}
        </Button>
      )}
    </>
  );
}
const documentLanguageForUi = (language: Language): DocumentLanguage =>
  language === "de" ? "en" : language;
