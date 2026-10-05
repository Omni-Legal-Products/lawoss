/**
 * Syntetický klientsky priečinok na test roztriedenia. Všetky mená, firmy a obsah sú vymyslené;
 * súbory nie sú skutočné PDF ani DOCX, pravidlá čítajú iba názov a príponu.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 35 súborov: e-maily, zmluvy SK/CZ, podania, rozhodnutia, koncepty, faktúry, rešerše a nejasné súbory. */
export const TRIAGE_FIXTURE: Readonly<Record<string, string>> = {
  "odpoved_klienta_2024-03-02.eml": "From: klient@vymyslena.example\nSubject: Odpoved\n\nSynteticky text.",
  "Re_ponuka.msg": "synteticka sprava",
  "Korespondencia 2024/list_protistrane.pdf": "%PDF-1.4 synthetic letter",
  "Korespondencia 2024/priloha.pdf": "%PDF-1.4 synthetic attachment A",
  "Stare/priloha.pdf": "%PDF-1.4 synthetic attachment B",
  "Zmluva o dielo - Vymyslena s.r.o..pdf": "%PDF-1.4 synthetic contract",
  "Zmluva_o_dielo_v2.docx": "synthetic docx bytes v2",
  "Kupna zmluva podpisana.pdf": "%PDF-1.4 synthetic signed",
  "Smlouva o dilo.pdf": "%PDF-1.4 synteticka smlouva",
  "Dodatok c. 1.pdf": "%PDF-1.4 synthetic amendment",
  "Plnomocenstvo.pdf": "%PDF-1.4 synthetic poa",
  "Plna moc - Fiktivni a.s..pdf": "%PDF-1.4 synteticka plna moc",
  "Faktura 2024-017.pdf": "%PDF-1.4 synthetic invoice",
  "Invoice_ACME_fictional.pdf": "%PDF-1.4 synthetic invoice en",
  "Zaloba o zaplatenie 8C_123_2023.pdf": "%PDF-1.4 synthetic claim",
  "Rozsudok 8C_123_2023.pdf": "%PDF-1.4 synthetic judgment",
  "Usneseni o nakladech.pdf": "%PDF-1.4 synteticke usneseni",
  "Uznesenie o trovach.pdf": "%PDF-1.4 synthetic resolution",
  "navrh_zaloby_draft.docx": "synthetic draft claim",
  "Vyjadrenie k odvolaniu.docx": "synthetic statement",
  "Odvolanie.pdf": "%PDF-1.4 synthetic appeal",
  "Navrh na vydanie platobneho rozkazu.pdf": "%PDF-1.4 synthetic filing",
  "Resers judikatury NS SR.docx": "synthetic research",
  "Pravne stanovisko k vypovedi.pdf": "%PDF-1.4 synthetic opinion",
  "Vypis z obchodneho registra.pdf": "%PDF-1.4 synthetic extract",
  "IMG_2041.jpg": "synthetic jpeg bytes",
  "scan0001.pdf": "%PDF-1.4 synthetic unknown scan",
  "poznamky.txt": "synteticke poznamky",
  "tabulka.xlsx": "synthetic xlsx bytes",
  "datova_sprava.zfo": "synthetic zfo",
  "Emaily/potvrdenie.pdf": "%PDF-1.4 synthetic confirmation",
  "Emaily/priloha.pdf": "%PDF-1.4 synthetic attachment C",
  "Drafty/memo.docx": "synthetic memo",
  "Podania/odpor.pdf": "%PDF-1.4 synthetic objection",
  "Fotky/IMG_3001.heic": "synthetic heic",
};

export async function writeTriageFixture(root: string, files: Readonly<Record<string, string>> = TRIAGE_FIXTURE): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}
