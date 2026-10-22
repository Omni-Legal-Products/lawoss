/**
 * Kam appka prejde po dokončení onboardingu (N-10, R2 bod 4; akceptácia 22. 10. 2026). Výslovný cieľ
 * (chat s klientom, Klienti a prípady pri čerstvej kancelárii, nastavenia AI) má prednosť; inak prehľad
 * zaregistrovaného klienta (pri praxi prvého klienta dávky, pri celej praxi jej priečinka), nie všeobecný Domov.
 */
import { workspaceProjectRoute } from "@/react-app/shell/workspace-routes";
import type { OnboardingCompletion } from "./lawoss-welcome-page";

export function onboardingLanding(completion: OnboardingCompletion | undefined, activeId: string | undefined): string {
  if (completion?.landing) return completion.landing;
  return activeId ? workspaceProjectRoute(activeId) : "/home";
}
