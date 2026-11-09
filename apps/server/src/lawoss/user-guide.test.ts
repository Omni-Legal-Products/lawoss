// LAWOSS (MČ 8. 11. 2026): agent pri otázkach na appku číta SK/CS príručku LAWOSS (skill `legalwork-help`).
// Test číta to, čo sa naozaj pribalí do workspace (`CORE_OPENCODE_FILES`), nie zdrojový priečinok: upstream
// príručka (Eigenwelt, platené plány, skryté plochy) sa nesmie dostať k agentovi a SK/CS stránky nesmú opisovať
// funkcie, ktoré LAWOSS skrýva.
import { describe, expect, test } from "bun:test";
import { posix } from "node:path";

import { CORE_OPENCODE_FILES } from "../core-skills.js";

const references = ".opencode/skills/legalwork-help/references/";
const pages = CORE_OPENCODE_FILES.filter((file) => file.path.startsWith(references) && file.path.endsWith(".md"));
const inLanguage = (language: string) => pages.filter((file) => file.path.startsWith(`${references}${language}/`));
const names = (language: string) => inLanguage(language).map((file) => posix.basename(file.path)).sort();

/** Zakázané pojmy: plochy, ktoré LAWOSS neukazuje (feature-flags.ts), a texty upstreamu, ktoré by ich opisovali. */
const FORBIDDEN_GUIDE_TERMS: ReadonlyArray<{ term: string; pattern: RegExp }> = [
  { term: "Eigenwelt", pattern: /eigenwelt/i },
  { term: "platené plány", pattern: /pla[tc]en[ýéá]\s+pl[aá]n|pla[tc]en[ée]\s+pl[aá]ny|\b(?:sync|plus|pro)\s+plan\b|subscription\s+plan/i },
  { term: "LegalWork cloud", pattern: /legalwork[\s-]*cloud|cloud\w*\s+legalwork/i },
  { term: "záznamník", pattern: /záznamník|recorder/i },
  { term: "diktovanie", pattern: /diktov|diktát|dictat/i },
  { term: "cloudový prepis Gemini", pattern: /gemini|transkrip|transcri|p[rř]epis\s+re[cč]i|cloudov\w*\s+p[rř]epis/i },
  { term: "Slack", pattern: /slack/i },
  { term: "Telegram", pattern: /telegram/i },
  { term: "router", pattern: /\brouter\b/i },
  { term: "Messaging", pattern: /messaging/i },
  { term: "zdieľanie s hosťami", pattern: /\bhos[tť](?:ia|í|é|ovi|ami|om)?\b|\bhostí\b|guest/i },
  { term: "Pre-release", pattern: /pre-?release|predbežn\w*\s+vydan|předběžn\w*\s+vydán/i },
  { term: "skryté plochy (wiki, kalendár, plánované úlohy, dashboardy)", pattern: /\bwiki\b|kalendár|kalendář|calendar|napl[aá]novan|scheduled|dashboard/i },
];

const violations = (content: string) => FORBIDDEN_GUIDE_TERMS.filter(({ pattern }) => pattern.test(content)).map(({ term }) => term);

describe("príručka LAWOSS pre agenta", () => {
  test("pribalí len SK/CS príručku LAWOSS, nie upstream stránky", () => {
    const outside = pages.filter((file) => !/\/(?:sk|cs)\/[^/]+\.md$/.test(file.path) && file.path !== `${references}index.md`);
    expect(outside.map((file) => file.path)).toEqual([]);
    expect(names("sk").length).toBeGreaterThanOrEqual(10);
    expect(names("cs")).toEqual(names("sk"));
    for (const upstream of ["email.md", "audio.md", "recorder-settings.md", "projects-sharing.md", "wiki.md", "calendar.md"]) {
      expect(pages.some((file) => posix.basename(file.path) === upstream)).toBe(false);
    }
  });

  test("SK ani CS príručka nespomína Eigenwelt, záznamník, Messaging, Slack ani iné skryté funkcie", () => {
    for (const file of [...inLanguage("sk"), ...inLanguage("cs")]) {
      expect({ page: file.path, terms: violations(file.content) }).toEqual({ page: file.path, terms: [] });
    }
  });

  test("skill a koreňový obsah príručky tiež neodkazujú na skryté funkcie", () => {
    const skill = CORE_OPENCODE_FILES.find((file) => file.path === ".opencode/skills/legalwork-help/SKILL.md");
    const index = pages.find((file) => file.path === `${references}index.md`);
    expect(skill?.content).toContain("references/sk/");
    expect(skill?.content).toContain("references/cs/");
    for (const file of [skill, index]) expect(violations(file?.content ?? "missing")).toEqual([]);
  });

  test("zakázané pojmy test naozaj zachytí", () => {
    for (const sample of ["Prihláste sa do Eigenwelt", "Otvorte Záznamník", "Nastavenia → Messaging", "router Slack", "Zdieľanie s hosťami", "kanál Pre-release", "cloudový prepis Gemini", "Diktovanie kdekoľvek"]) {
      expect(violations(sample).length).toBeGreaterThan(0);
    }
    for (const allowed of ["localhost", "Povoliť pre tohto klienta", "legalwork://app/settings/ai", "predplatné ChatGPT", "Predbežné"]) {
      expect(violations(allowed)).toEqual([]);
    }
  });

  test("každá stránka používa pojmy LAWOSS: klient, prípad (případ), chat", () => {
    const sk = inLanguage("sk").map((file) => file.content).join("\n");
    const cs = inLanguage("cs").map((file) => file.content).join("\n");
    for (const term of [/\bklient/i, /prípad/i, /\bchat/i, /Pripojené priečinky/]) expect(sk).toMatch(term);
    for (const term of [/\bklient/i, /případ/i, /\bchat/i, /Připojené složky/]) expect(cs).toMatch(term);
    // Upstream pojem „projekt“ LAWOSS volá klient.
    expect(sk).not.toMatch(/\bprojekt/i);
    expect(cs).not.toMatch(/\bprojekt/i);
  });
});
