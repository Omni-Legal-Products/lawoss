/** @jsxImportSource react */
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { AI_GUIDANCE_VERSION, type AiGovernanceView } from "@legalwork/types/ai-governance";
import type { Language } from "@/i18n";
import { createLegalworkServerClient } from "@/app/lib/legalwork-server";
import { resolveLegalworkConnection, type ResolvedLegalworkConnection } from "@/react-app/shell/legalwork-connection";

const copy: Record<Language, {title: string; remote: string; reading: string; profile: string; action: string; blocked: string; bounded: string; acknowledge: string; saved: string; failed: string; jurisdiction: string}> = {
  cs: {
    bounded: "Zpracování vybraných dokumentů má samostatný podmíněný režim: výslovně vyberete existující posouzený profil věci pro nastavený účet a model. Hostitel zkontroluje konkrétní složku, zdroje a každý úplný přenos. Nové právní schválení zde vytvořit nelze; bez profilu pokračujte ručně. Syntetický test na doslovné loopback adrese vyžaduje samostatné potvrzení hostitele a nevytváří klientské oprávnění.",
    title: "AI a chráněné údaje",
    remote: "Vzdálená AI předává obsah i odvozené údaje mimo zařízení. Označení místního modelu nebo adresa localhost samy nedokládají místní zpracování.",
    reading: "Potvrzení přečtení zaznamená pouze tuto informaci. Nenahrazuje souhlas klienta, DPA ani posouzení konkrétní služby.",
    profile: "Použití chráněných údajů vyžaduje posouzení konkrétního účtu, účelu, kategorií údajů a příslušných jurisdikcí. Přihlášení ani placený tarif takové posouzení nenahrazují.",
    action: "Odeslání, podání nebo podpis se schvalují samostatně pro konkrétní úkon.",
    blocked: "Běžný chat s neověřeným kontextem, vzdálené OCR, SystemOne a živý hlasový režim jsou v tomto sestavení blokované. Veřejný text lze samostatně otestovat níže v odděleném prostředí. Ověření modelové hranice a kancelářské politiky není dokončeno. Blokace platí i pro localhost a zadání bez ověřeného kontextu. Model lze nastavit; pokračovat můžete bez něj. Ruční práce a soubory zůstávají dostupné.",
    jurisdiction: "Jurisdikce informace", acknowledge: "Přečetl/a jsem informaci", saved: "Přečtení zaznamenáno. Povolení AI tím nevzniká.", failed: "Přečtení se nepodařilo zaznamenat na tomto zařízení.",
  },
  sk: {
    bounded: "Spracovanie vybraných dokumentov má samostatný podmienený režim: výslovne vyberiete existujúci posúdený profil veci pre nastavený účet a model. Hostiteľ skontroluje konkrétny priečinok, zdroje a každý úplný prenos. Nové právne schválenie tu vytvoriť nemožno; bez profilu pokračujte ručne. Syntetický test na doslovnej loopback adrese vyžaduje samostatné potvrdenie hostiteľa a nevytvára klientské oprávnenie.",
    title: "AI a chránené údaje",
    remote: "Vzdialená AI odovzdáva obsah aj odvodené údaje mimo zariadenia. Označenie miestneho modelu alebo adresa localhost samy nedokladajú miestne spracovanie.",
    reading: "Potvrdenie prečítania zaznamená iba túto informáciu. Nenahrádza súhlas klienta, DPA ani posúdenie konkrétnej služby.",
    profile: "Použitie chránených údajov vyžaduje posúdenie konkrétneho účtu, účelu, kategórií údajov a príslušných jurisdikcií. Prihlásenie ani platený program také posúdenie nenahrádzajú.",
    action: "Odoslanie, podanie alebo podpis sa schvaľujú samostatne pre konkrétny úkon.",
    blocked: "Bežný chat s neovereným kontextom, vzdialené OCR, SystemOne a živý hlasový režim sú v tomto zostavení blokované. Verejný text možno samostatne otestovať nižšie v oddelenom prostredí. Overenie modelovej hranice a kancelárskej politiky nie je dokončené. Blokovanie platí aj pre localhost a zadanie bez overeného kontextu. Model možno nastaviť; pokračovať môžete bez neho. Ručná práca a súbory zostávajú dostupné.",
    jurisdiction: "Jurisdikcia informácie", acknowledge: "Prečítal/a som informáciu", saved: "Prečítanie zaznamenané. Povolenie AI tým nevzniká.", failed: "Prečítanie sa nepodarilo zaznamenať na tomto zariadení.",
  },
  en: {
    bounded: "Selected document processing has a separate conditional mode: explicitly choose an existing reviewed matter profile for the configured account and model. The host reviews the exact directory, sources and every complete transmission. New legal approvals cannot be created here; without a profile continue manually. A synthetic test on a literal loopback address requires separate native review and creates no client grant.",
    title: "AI and protected information",
    remote: "Remote AI sends content and derived information outside this device. A local label or localhost address alone does not verify local processing.",
    reading: "A reading acknowledgment records this information only. It does not replace client consent, a DPA or a review of the particular service.",
    profile: "Protected information requires a review of the particular account, purpose, data categories and applicable jurisdictions. Signing in or paying for a plan does not replace that review.",
    action: "Sending, filing and signing require a separate confirmation of the particular action.",
    blocked: "Ordinary chat with an unverified context, remote OCR, SystemOne and realtime voice are blocked in this build. Public text can be tested separately below in an isolated environment. The model boundary and firm policy are not yet verified. This also applies to localhost and requests without a verified context. You can configure a model and continue without it; manual work and files remain available.",
    jurisdiction: "Information jurisdiction", acknowledge: "I have read this information", saved: "Reading recorded. This does not grant AI permission.", failed: "Reading could not be recorded on this device.",
  },
  de: {
    bounded: "Für ausgewählte Dokumente besteht ein gesonderter bedingter Modus: Wählen Sie ausdrücklich ein bestehendes geprüftes Mandatsprofil für das konfigurierte Konto und Modell. Der Host prüft Verzeichnis, Quellen und jede vollständige Übertragung. Neue rechtliche Freigaben können hier nicht erstellt werden; ohne Profil arbeiten Sie manuell weiter. Ein synthetischer Test an einer wörtlichen Loopback-Adresse erfordert eine separate Hostprüfung und erzeugt keine Mandantenfreigabe.",
    title: "KI und geschützte Informationen",
    remote: "Remote-KI überträgt Inhalte und abgeleitete Informationen außerhalb dieses Geräts. Eine lokale Bezeichnung oder localhost-Adresse belegt keine lokale Verarbeitung.",
    reading: "Die Lesebestätigung dokumentiert nur diese Information. Sie ersetzt weder Mandanteneinwilligung, DPA noch die Prüfung des konkreten Dienstes.",
    profile: "Geschützte Informationen erfordern eine Prüfung von Konto, Zweck, Datenkategorien und einschlägigen Rechtsordnungen. Anmeldung oder Bezahltarif ersetzen diese Prüfung nicht.",
    action: "Versand, Einreichung und Signatur erfordern eine eigene Bestätigung des konkreten Vorgangs.",
    blocked: "Normaler Chat mit ungeprüftem Kontext, Remote-OCR, SystemOne und Echtzeit-Sprache sind in diesem Build gesperrt. Öffentlicher Text kann unten separat in einer isolierten Umgebung getestet werden. Modellgrenze und Kanzleirichtlinie sind noch nicht geprüft. Dies gilt auch für localhost und Anfragen ohne verifizierten Kontext. Sie können ein Modell konfigurieren und ohne Modell fortfahren; manuelle Arbeit und Dateien bleiben verfügbar.",
    jurisdiction: "Rechtsordnung der Information", acknowledge: "Ich habe die Information gelesen", saved: "Lesen erfasst. Dadurch entsteht keine KI-Freigabe.", failed: "Das Lesen konnte auf diesem Gerät nicht erfasst werden.",
  },
};

export function createAiGuidanceClient(connection: ResolvedLegalworkConnection) {
  return createLegalworkServerClient({baseUrl: connection.normalizedBaseUrl, token: connection.resolvedToken, hostToken: connection.resolvedHostToken});
}

/** Shared informational view: no checkbox or browser state can activate a provider. */
export function AiGuidance({locale}: {locale: Language}) {
  const text = copy[locale], id = useId();
  const [view, setView] = useState<AiGovernanceView | null>(null);
  const [providerId, setProviderId] = useState(""), [modelId, setModelId] = useState(""), [publicText, setPublicText] = useState("");
  const [publicBusy, setPublicBusy] = useState(false), [publicReply, setPublicReply] = useState(""), [publicError, setPublicError] = useState("");
  const publicCopy = {
    cs: {title: "Veřejný text v odděleném prostředí", note: "Pouze veřejný nebo syntetický text. Test běží v prázdné složce bez klientských souborů, paměti, nástrojů, MCP a shellu. Skutečný systémový a zprávový kontext každého přenosu schválíte zvlášť v okně hostitele. Nejde o právní schválení poskytovatele.", provider: "Nastavený poskytovatel", model: "Model", text: "Veřejný text", run: "Připravit veřejný požadavek", running: "Čekám na potvrzení hostitele a odpověď modelu…", unavailable: "Veřejný test vyžaduje spuštěný spravovaný engine a nastaveného OpenAI-compatible poskytovatele s modelem. Chráněný kontext zůstává blokovaný."},
    sk: {title: "Verejný text v oddelenom prostredí", note: "Iba verejný alebo syntetický text. Test beží v prázdnom priečinku bez klientskych súborov, pamäte, nástrojov, MCP a shellu. Skutočný systémový a správový kontext každého prenosu schválite osobitne v okne hostiteľa. Nejde o právne schválenie poskytovateľa.", provider: "Nastavený poskytovateľ", model: "Model", text: "Verejný text", run: "Pripraviť verejnú požiadavku", running: "Čakám na potvrdenie hostiteľa a odpoveď modelu…", unavailable: "Verejný test vyžaduje spustený spravovaný engine a nastaveného OpenAI-compatible poskytovateľa s modelom. Chránený kontext zostáva blokovaný."},
    en: {title: "Public text in a separate environment", note: "Public or synthetic text only. The test uses an empty directory without client files, memory, tools, MCP or shell. Approve the complete actual system and message context of each transmission separately in the native host window. This is not legal approval of a provider.", provider: "Configured provider", model: "Model", text: "Public text", run: "Prepare public request", running: "Waiting for native host review and the model reply…", unavailable: "The public test requires a running managed engine and a configured OpenAI-compatible provider with a model. Protected context remains blocked."},
    de: {title: "Öffentlicher Text in separater Umgebung", note: "Nur öffentliche oder synthetische Texte. Der Test nutzt einen leeren Ordner ohne Mandantendateien, Speicher, Tools, MCP oder Shell. Bestätigen Sie den vollständigen tatsächlichen System- und Nachrichtenkontext jeder Übertragung separat im nativen Hostfenster. Dies ist keine rechtliche Anbieterfreigabe.", provider: "Konfigurierter Anbieter", model: "Modell", text: "Öffentlicher Text", run: "Öffentliche Anfrage vorbereiten", running: "Warte auf Hostbestätigung und Modellantwort…", unavailable: "Der öffentliche Test benötigt eine laufende verwaltete Engine und einen konfigurierten OpenAI-kompatiblen Anbieter mit Modell. Geschützter Kontext bleibt gesperrt."},
  }[locale];
  const targets = view?.publicContext?.targets ?? [];
  const models = targets.find(target => target.id === providerId)?.models ?? [];
  const runPublic = async () => {
    setPublicBusy(true); setPublicError(""); setPublicReply("");
    try {
      const connection = await resolveLegalworkConnection();
      if (!connection.normalizedBaseUrl) throw new Error(publicCopy.unavailable);
      const result = await createAiGuidanceClient(connection).runPublicAiPrompt({providerId, modelId, text: publicText});
      setPublicReply(result.reply);
    } catch (error) {setPublicError(error instanceof Error ? error.message : publicCopy.unavailable);} finally {setPublicBusy(false);}
  };
  const [jurisdiction, setJurisdiction] = useState<"CZ" | "SK" | null>(null);
  const [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void resolveLegalworkConnection().then(connection => connection.normalizedBaseUrl
      ? createAiGuidanceClient(connection).aiGovernance() : null).then(view => {
      if (active) {setView(view); setSaved(view?.guidanceAck?.textVersion === AI_GUIDANCE_VERSION);}
    }).catch(() => {});
    return () => {active = false;};
  }, []);
  const acknowledge = async () => {
    setBusy(true); setFailed(false);
    try {
      const connection = await resolveLegalworkConnection();
      if (!connection.normalizedBaseUrl || !jurisdiction) throw new Error("host unavailable");
      await createAiGuidanceClient(connection).acknowledgeAiGuidance(AI_GUIDANCE_VERSION, jurisdiction);
      setSaved(true);
    } catch {setFailed(true);} finally {setBusy(false);}
  };
  return <aside aria-labelledby={id} data-lawoss-ai-governance="unsupported" className="space-y-2 rounded border border-amber-500/60 p-3 text-sm">
    <h3 id={id} className="font-semibold">{text.title}</h3>
    <p>{text.remote}</p><p>{text.reading}</p><p>{text.profile}</p><p>{text.action}</p>
    <p role="status" className="font-medium">{text.blocked}</p>
    {view?.boundedDocuments?.state === "conditional" ? <p>{text.bounded}</p> : null}
    {saved ? <p>{text.saved}</p> : <>
      <label className="flex items-center gap-2">{text.jurisdiction}
        <select aria-label={text.jurisdiction} value={jurisdiction ?? ""} onChange={event => {
          const value = event.target.value; setJurisdiction(value === "CZ" || value === "SK" ? value : null);
        }} className="rounded border p-1">
          <option value="">—</option><option value="CZ">CZ</option><option value="SK">SK</option>
        </select>
      </label>
      <Button variant="outline" size="sm" disabled={busy || !jurisdiction} onClick={() => void acknowledge()}>{text.acknowledge}</Button></>}
    {failed ? <p role="alert">{text.failed}</p> : null}
    <section aria-label={publicCopy.title} className="space-y-2 border-t pt-3">
      <h4 className="font-semibold">{publicCopy.title}</h4><p>{publicCopy.note}</p>
      {view?.publicContext?.available && targets.length ? <>
        <label className="flex items-center gap-2">{publicCopy.provider}<select value={providerId} onChange={event => {setProviderId(event.target.value); setModelId("");}}><option value="">—</option>{targets.map(target => <option key={target.id} value={target.id}>{target.id}</option>)}</select></label>
        <label className="flex items-center gap-2">{publicCopy.model}<select value={modelId} onChange={event => setModelId(event.target.value)}><option value="">—</option>{models.map(model => <option key={model} value={model}>{model}</option>)}</select></label>
        <label className="block">{publicCopy.text}<textarea className="block w-full rounded border p-2" maxLength={16000} value={publicText} onChange={event => setPublicText(event.target.value)} /></label>
        <Button variant="outline" size="sm" disabled={publicBusy || !providerId || !modelId || !publicText.trim()} onClick={() => void runPublic()}>{publicBusy ? publicCopy.running : publicCopy.run}</Button>
      </> : <p>{publicCopy.unavailable}</p>}
      {publicReply ? <output role="status" className="block whitespace-pre-wrap">{publicReply}</output> : null}
      {publicError ? <p role="alert">{publicError}</p> : null}
    </section>
  </aside>;
}
