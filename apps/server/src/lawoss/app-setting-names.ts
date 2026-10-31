/**
 * LAWOSS (N-A8-2, regresia 30. 10. 2026): názvy nastavení v textoch pre model tak, ako ich advokát vidí v appke.
 * Model ich inak preberal po anglicky („Settings → AI Providers → Text recognition from scans (OCR)“,
 * „Settings > Permissions“) a advokát ich v slovenských nastaveniach nenašiel. Texty pre model sú anglické,
 * názvy obrazoviek ostávajú slovenské, s českými v zátvorke (appka má obe). Pevný text: nemení sa za behu
 * (AGENTS.md „Prompt caching“).
 */
export const AI_PROVIDERS_SETTING = "Nastavenia → Poskytovatelia AI (Czech app: Nastavení → Poskytovatelé AI)";
export const OCR_SETTING = "Nastavenia → Poskytovatelia AI → Rozpoznávanie textu zo skenov (OCR) (Czech app: Nastavení → Poskytovatelé AI → Rozpoznávání textu ze skenů (OCR))";

/** Pravidlo systémového promptu: názov appky a nastavení, nikdy rada rozšíriť prístup na iného klienta. */
export const APP_NAMES_SYSTEM = [
  "This app is LAWOSS; call it LAWOSS, never LegalWork.",
  "Its screens are in the user's language. When you point the user to a setting, use the names the app shows, never English names of settings or screens.",
  "Slovak names (Czech in brackets): Nastavenia → Poskytovatelia AI (Nastavení → Poskytovatelé AI) for AI models, with the switch Rozpoznávanie textu zo skenov (OCR) (Rozpoznávání textu ze skenů (OCR)); Nastavenia → Oprávnenia nástrojov (Nastavení → Oprávnění nástrojů) for what the agent may do without asking; Nastavenia → Rozšírenia (Nastavení → Rozšíření) for connectors.",
  "Folders of this client that lie outside its folder are linked by the user under Pripojené priečinky (Připojené složky) on the client's overview.",
  "Never advise the user to allow, authorize or link a folder of another client, a folder that contains other clients' folders, or a folder above the client's folder.",
].join(" ");
