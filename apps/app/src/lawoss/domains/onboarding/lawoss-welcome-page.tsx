/** @jsxImportSource react */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Check, ExternalLink, FileWarning, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/i18n/use-locale";
import { setLanguagePreference, type Language } from "@/i18n";
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
  visibleOnboardingStep,
  visibleOnboardingSteps,
  writeOnboardingProgress,
} from "./onboarding-state";

const today = () => new Date().toISOString().slice(0, 10);
const documentLanguage = (language: Language): DocumentLanguage =>
  language === "de" ? "en" : language;
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.trim() ? error.message : fallback;
const text: Record<Language, Record<string, string>> = {
  en: {
    title: "Set up your legal practice",
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
    lawyer: "Lawyer name",
    jurisdiction: "Jurisdiction",
    language: "Interface language",
    new: "Create new",
    existing: "Connect existing",
    parent: "Parent folder",
    name: "Name",
    path: "Folder path",
    aiText:
      "Choose a provider and model in the existing AI settings. This onboarding does not create a separate AI configuration.",
    aiOpen: "Open AI settings",
    aiDone: "I have reviewed my AI settings",
    type: "Client type",
    company: "Company",
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
      "No office workspace is created. The active workspace is always the client folder.",
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
    title: "Nastavte advokátsku prax",
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
    lawyer: "Meno advokáta",
    jurisdiction: "Jurisdikcia",
    language: "Jazyk rozhrania",
    new: "Vytvoriť novú",
    existing: "Pripojiť existujúcu",
    parent: "Nadradený priečinok",
    name: "Názov",
    path: "Cesta k priečinku",
    aiText:
      "Poskytovateľa a model vyberte v pôvodných nastaveniach AI. Tento onboarding nevytvára samostatnú konfiguráciu AI.",
    aiOpen: "Otvoriť nastavenia AI",
    aiDone: "Skontroloval som nastavenia AI",
    type: "Typ klienta",
    company: "Právnická osoba",
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
      "Pre kanceláriu nevznikne pracovný priestor. Aktívnym pracovným priestorom je vždy priečinok klienta.",
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
    title: "Nastavte advokátní praxi",
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
    lawyer: "Jméno advokáta",
    jurisdiction: "Jurisdikce",
    language: "Jazyk rozhraní",
    new: "Vytvořit novou",
    existing: "Připojit existující",
    parent: "Nadřazená složka",
    name: "Název",
    path: "Cesta ke složce",
    aiText:
      "Poskytovatele a model zvolte v původním nastavení AI. Tento onboarding nevytváří samostatnou konfiguraci AI.",
    aiOpen: "Otevřít nastavení AI",
    aiDone: "Zkontroloval jsem nastavení AI",
    type: "Typ klienta",
    company: "Právnická osoba",
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
      "Pro kancelář nevznikne pracovní prostor. Aktivním pracovním prostorem je vždy složka klienta.",
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
    title: "Richten Sie Ihre Kanzlei ein",
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
    lawyer: "Name der Rechtsanwältin oder des Rechtsanwalts",
    jurisdiction: "Jurisdiktion",
    language: "Sprache der Oberfläche",
    new: "Neu erstellen",
    existing: "Bestehende verbinden",
    parent: "Übergeordneter Ordner",
    name: "Name",
    path: "Ordnerpfad",
    aiText:
      "Wählen Sie Anbieter und Modell in den vorhandenen KI-Einstellungen. Dieses Onboarding erstellt keine getrennte KI-Konfiguration.",
    aiOpen: "KI-Einstellungen öffnen",
    aiDone: "Ich habe die KI-Einstellungen geprüft",
    type: "Mandantentyp",
    company: "Unternehmen",
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
      "Für die Kanzlei wird kein Arbeitsbereich erstellt. Der aktive Arbeitsbereich ist immer der Mandantenordner.",
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
    workingFolderHelp: "Priečinok pridáme ako pracovný priestor. Nevytvoríme v ňom štruktúru OKF ani skills OKF.",
    finish: "Dokončiť",
  },
  cs: {
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
    workingFolderHelp: "Složku přidáme jako pracovní prostor. Nevytvoříme v ní strukturu OKF ani skills OKF.",
    finish: "Dokončit",
  },
  en: {
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
    workingFolderHelp: "The folder is added as a workspace. No OKF structure or OKF skills are created in it.",
    finish: "Finish",
  },
  de: {
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
    workingFolderHelp: "Der Ordner wird als Arbeitsbereich hinzugefügt. Es werden darin keine OKF-Struktur und keine OKF-Skills angelegt.",
    finish: "Abschließen",
  },
};
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
      className="h-9 rounded border px-3"
      value={value}
      onChange={(event) => onChange(event.target.value as DocumentLanguage)}
    >
      <option value="sk">SK</option>
      <option value="cs">CS</option>
      <option value="en">EN</option>
    </select>
  );
}
/** Completion details that are not an onboarding apply result. */
export type OnboardingCompletion = { workingFolder?: string };
type Props = {
  api: OnboardingApi;
  initialStep?: OnboardingStep;
  onComplete: (
    result?: OnboardingApplyResult,
    completion?: OnboardingCompletion,
  ) => void | Promise<void>;
  onOpenAiSettings: () => void;
  pickDirectory: () => Promise<string | null>;
};
export function LawossWelcomePage({
  api,
  initialStep,
  onComplete,
  onOpenAiSettings,
  pickDirectory,
}: Props) {
  const locale = useLocale();
  const tr = (key: string) =>
    key === "cancel"
      ? { en: "Cancel", sk: "Zrušiť", cs: "Zrušit", de: "Abbrechen" }[locale]
      : (extraText[locale][key] ?? text[locale][key]);
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
  const completion = (): OnboardingCompletion | undefined =>
    workingFolder.trim() ? { workingFolder: workingFolder.trim() } : undefined;
  useEffect(() => {
    void api
      .onboardingStatus()
      .then((status) => {
        setProfile(status.profile);
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
      .catch(() => setError(tr("error")));
  }, [api, initialStep]);
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
      setError(errorMessage(reason, tr("error")));
    } finally {
      setBusy(false);
    }
  };
  const plan = async (request: OnboardingPlanRequest) => {
    setBusy(true);
    setError(null);
    try {
      const pending = { request, value: await api.planOnboarding(request) };
      setPreview(pending);
      writePendingOnboarding(window.localStorage, pending);
    } catch (reason) {
      setError(errorMessage(reason, tr("error")));
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
      setError(errorMessage(reason, tr("error")));
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
      setError(errorMessage(reason, tr("error")));
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
      setError(errorMessage(reason, tr("error")));
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
      <main
        className="mx-auto min-h-screen max-w-3xl px-5 py-10"
        data-lawoss-onboarding-step={step}
      >
        <header>
          <p className="text-sm text-muted-foreground">LAWOSS</p>
          <h1 className="mt-1 text-3xl font-semibold">{tr("title")}</h1>
          <ol
            className="mt-6 grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
            }}
          >
            {steps.map((item, i) => (
              <li
                key={item}
                className={
                  i <= idx ? "text-foreground" : "text-muted-foreground"
                }
              >
                <span className="mb-1 block h-1 rounded bg-current" />
                <span className="text-xs">
                  {i + 1}. {tr(item)}
                </span>
              </li>
            ))}
          </ol>
        </header>
        {error ? (
          <p
            role="alert"
            className="mt-5 rounded border border-destructive p-3"
          >
            {error}
          </p>
        ) : null}
        <section className="mt-8 grid gap-5">
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
                  setError(errorMessage(reason, tr("error")));
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
                move(enabled ? "office" : "ai", {
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
                  setError(errorMessage(reason, tr("error")));
                }
              }}
            />
          ) : null}
          {step === "ai" ? (
            <>
              <h2 className="text-xl font-semibold">{tr("ai")}</h2>
              <p className="text-muted-foreground">{tr("aiText")}</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onOpenAiSettings}>
                  <ExternalLink />
                  {tr("aiOpen")}
                </Button>
                {okfEnabled === false ? null : (
                  <Button onClick={() => void move(stepAfterAi(okfEnabled))}>
                    {tr("aiDone")}
                  </Button>
                )}
              </div>
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
            />
          ) : null}
          {step === "matter" ? (
            <Matter
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
                  setError(errorMessage(reason, tr("error")));
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
                  setError(errorMessage(reason, tr("error")));
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : null}
          {step === "done" ? (
            <>
              <Check className="size-8 text-green-600" />
              <p>{tr("done")}</p>
              <Button disabled={busy} onClick={() => void complete()}>
                {tr("open")}
              </Button>
            </>
          ) : null}
        </section>
        {preview ? (
          <section className="mt-7 rounded-lg border border-primary/30 bg-primary/5 p-5">
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
              <p key={item} className="mt-2 text-sm text-amber-800">
                {item}
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
          className="h-9 rounded border px-3"
          value={jurisdiction}
          onChange={(e) => setJurisdiction(e.target.value as "sk" | "cz")}
        >
          <option value="sk">Slovakia</option>
          <option value="cz">Czechia</option>
        </select>,
      )}
      {field(
        tr("language"),
        <select
          className="h-9 rounded border px-3"
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
        >
          {["sk", "cs", "en", "de"].map((x) => (
            <option key={x}>{x}</option>
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
function Client({
  base,
  locale,
  tr,
  busy,
  onPlan,
}: {
  base: OnboardingProfile;
  locale: Language;
  tr: (key: string) => string;
  busy: boolean;
  onPlan: (r: OnboardingPlanRequest) => Promise<void>;
}) {
  const [existing, setExisting] = useState(false);
  const [value, setValue] = useState("");
  const [clientParent, setClientParent] = useState("");
  const [docLanguage, setDocLanguage] = useState<DocumentLanguage>(
    documentLanguage(locale),
  );
  const [confirmedClient, setConfirmedClient] = useState(false);
  const [type, setType] = useState<ClientType>("po");
  const [mode, setMode] = useState<ExistingClientMode>("convert");
  const [memoryPath, setMemoryPath] = useState("");
  const [identityAnchor, setIdentityAnchor] = useState("");
  const [cloneParent, setCloneParent] = useState("");
  const request = (): OnboardingPlanRequest =>
    existing
      ? {
          action: "existing",
          root: value,
          mode,
          title: value.split("/").pop() || "Client",
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
    (!existing || mode === "map" || confirmedClient);
  return (
    <>
      <h2 className="text-xl font-semibold">{tr("client")}</h2>
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
        existing ? tr("path") : tr("name"),
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
          className="h-9 rounded border px-3"
          value={type}
          onChange={(e) => setType(e.target.value as ClientType)}
        >
          <option value="po">{tr("company")}</option>
          <option value="fo">{tr("person")}</option>
          <option value="fo-podnikatel">{tr("soleTrader")}</option>
          <option value="iny">{tr("other")}</option>
        </select>,
      )}
      {existing ? (
        <>
          {field(
            tr("mode"),
            <select
              className="h-9 rounded border px-3"
              value={mode}
              onChange={(e) => setMode(e.target.value as ExistingClientMode)}
            >
              {(["convert", "map", "trial_clone"] as const).map((x) => (
                <option key={x} value={x}>
                  {tr(x)}
                </option>
              ))}
            </select>,
          )}
          {mode === "map" ? (
            <div className="grid gap-3 rounded border p-4">
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
          {mode === "trial_clone"
            ? field(
                tr("parent"),
                <PathInput value={cloneParent} onChange={setCloneParent} />,
              )
            : null}
        </>
      ) : null}
      <Button disabled={busy || !valid} onClick={() => void onPlan(request())}>
        {tr("preview")}
      </Button>
    </>
  );
}
function Matter({
  base,
  locale,
  tr,
  busy,
  onPlan,
  onClientChange,
  onSubjectChange,
}: {
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
      <h2 className="text-xl font-semibold">{tr("matter")}</h2>
      {field(
        tr("client"),
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
            {tr("save")}
          </Button>
          {root ? (
            <p className="text-sm text-muted-foreground">{root}</p>
          ) : null}
        </div>,
      )}
      {trial ? (
        <div className="rounded border border-amber-500 bg-amber-50 p-4">
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
            className="h-9 rounded border px-3"
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
          className="h-9 rounded border px-3"
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
          className="h-9 rounded border px-3"
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
