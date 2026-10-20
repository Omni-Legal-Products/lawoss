import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { shellCs, shellSk } from "../src/lawoss/i18n/shell";
import { mattersCs, mattersSk } from "../src/lawoss/i18n/matters";
import { setupCs, setupSk } from "../src/lawoss/i18n/setup";
import { integrationsCs, integrationsSk } from "../src/lawoss/i18n/integrations";
import { FOUND_TEXT } from "../src/lawoss/domains/onboarding/found-text";
import { welcomeText, welcomeTextKeys } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { entryActionLabels } from "../src/lawoss/domains/onboarding/entry-actions";
import { MARKETPLACE_CATALOG } from "../src/lawoss/domains/marketplace/catalog";
import { composePrompt, type NovySpisForm } from "../src/lawoss/okf/compose-prompt";
import { groupPlan } from "../src/lawoss/okf/plan-groups";
import { readWorkspaceMemory, type OkfReadClient } from "../src/lawoss/okf/read-model";
import { MORE_ACTIONS, QUICK_ACTIONS, composeQuickAction } from "../src/lawoss/lite/quick-actions";

// Rozhodnutie MČ 19. 10. 2026: jednotka práce pod klientom je v rozhraní „Prípad“ (SK) / „Případ“ (CS),
// nie „vec“ / „věc“. Kľúče, trasy (`?vec=`) a formát OKF ostávajú.
// Strážca zachytí aj „veci/věci“ vo význame „things“: taký text preformulujte, regex neuvoľňujte.
const OLD_SK = /(?<!\p{L})[Vv]ec(i|ou|í|iam|ami|iach)?(?!\p{L})/u;
const OLD_CS = /(?<!\p{L})[Vv]ěc(i|í|em|mi|ech)?(?!\p{L})/u;
const OLD = new RegExp(`${OLD_SK.source}|${OLD_CS.source}`, "u");

const withOld = (dict: Record<string, string>): string[] =>
  Object.entries(dict).filter(([, value]) => OLD.test(value)).map(([key, value]) => `${key}: ${value}`);

describe("Prípad namiesto veci (SK, CS)", () => {
  test("slovníky LAWOSS v SK a CS už nehovoria o veci", () => {
    for (const dict of [shellSk, shellCs, mattersSk, mattersCs, setupSk, setupCs, integrationsSk, integrationsCs, FOUND_TEXT.sk, FOUND_TEXT.cs]) {
      expect(withOld(dict)).toEqual([]);
    }
  });

  test("hlavné popisky v bočnom paneli, na Klientoch a v strome", () => {
    expect(shellSk["lawoss.lite.nav_clients"]).toBe("Klienti a prípady");
    expect(shellCs["lawoss.lite.nav_clients"]).toBe("Klienti a případy");
    expect(shellSk["lawoss.lite.new_matter"]).toBe("Nový prípad");
    expect(shellCs["lawoss.lite.new_matter"]).toBe("Nový případ");
    expect(shellSk["lawoss.lite.scope_matter"]).toBe("Prípad");
    expect(shellCs["lawoss.lite.scope_matter"]).toBe("Případ");
    expect(shellSk["lawoss.lite.client_no_matters"]).toBe("Zatiaľ bez prípadov.");
    expect(shellCs["lawoss.lite.client_no_matters"]).toBe("Zatím bez případů.");
    expect(shellSk["lawoss.triage.new_matter_badge"]).toBe("nový prípad");
    expect(shellCs["lawoss.triage.new_matter_badge"]).toBe("nový případ");
  });

  test("onboarding: formulár nového prípadu", () => {
    const sk = welcomeText("sk");
    const cs = welcomeText("cs");
    expect(sk("matter")).toBe("Prvý prípad");
    expect(cs("matter")).toBe("První případ");
    expect(sk("newMatter")).toBe("Nový prípad");
    expect(cs("newMatter")).toBe("Nový případ");
    expect(sk("matterUnder")).toBe("Prípad vznikne pod klientom");
    expect(cs("matterUnder")).toBe("Případ vznikne pod klientem");
    expect(sk("noClientYet")).toBe("Vyberte priečinok klienta, pod ktorým prípad vznikne.");
    expect(cs("noClientYet")).toBe("Vyberte složku klienta, pod kterým případ vznikne.");
    for (const locale of ["sk", "cs"] as const) {
      const keys = welcomeTextKeys(locale);
      expect(keys.length).toBeGreaterThan(50);
      const tr = welcomeText(locale);
      expect(keys.filter((key) => OLD.test(tr(key)))).toEqual([]);
    }
  });

  test("rýchle akcie hovoria o prípade", () => {
    const matter = { title: "Novák - 14 C 101/2025", matterRef: "14 C 101/2025", path: "Klienti/Novák/Spisy/Odvolanie" };
    for (const id of ["open", ...QUICK_ACTIONS.map((a) => a.id), ...MORE_ACTIONS.map((a) => a.id)] as const) {
      expect(composeQuickAction(id, matter, "sk")).not.toMatch(OLD);
      expect(composeQuickAction(id, matter, "cs")).not.toMatch(OLD);
    }
    expect(composeQuickAction("open", matter, "sk")).toContain("Pracujeme na prípade");
    expect(composeQuickAction("open", matter, "cs")).toContain("Pracujeme na případu");
  });

  test("druh prípadu: spor alebo nesporová agenda; v zozname druhov „Iné“", () => {
    expect(welcomeText("sk")("kind")).toBe("Druh prípadu");
    expect(welcomeText("sk")("contentious")).toBe("Spor (konanie)");
    expect(welcomeText("sk")("non_contentious")).toBe("Nesporová agenda");
    expect(welcomeText("cs")("kind")).toBe("Druh případu");
    expect(welcomeText("cs")("contentious")).toBe("Spor (řízení)");
    expect(welcomeText("cs")("non_contentious")).toBe("Nesporná agenda");
    expect(setupSk["lawoss.setup.wizard.otherMatter"]).toBe("Iné");
    expect(setupCs["lawoss.setup.wizard.otherMatter"]).toBe("Jiné");
    expect(mattersSk["lawoss.matters.chooseOne"]).toBe("{count} · vyberte jeden");
  });

  test("akcie v bočnom paneli a na Klientoch", () => {
    expect(entryActionLabels("sk").matter).toBe("Nový prípad");
    expect(entryActionLabels("cs").matter).toBe("Nový případ");
    expect(withOld({ ...entryActionLabels("sk") })).toEqual([]);
    expect(withOld({ ...entryActionLabels("cs") })).toEqual([]);
  });

  test("marketplace: položka OKF", () => {
    const okf = MARKETPLACE_CATALOG.find((entry) => entry.id === "okf");
    expect(okf?.name).toBe("OKF: klienti, prípady a pamäť");
    expect(okf?.humanGate).toBe("Zápisy do prípadu sa vykonajú po potvrdení zobrazeného plánu.");
  });

  test("požiadavka pre asistenta pri zakladaní klienta a prípadu", () => {
    const base: NovySpisForm = { mode: "okf", subject: "spis", title: "Spor Alfa", ico: "", jurisdikcia: "SK", root: "/office/Klient/Spisy", protistrana: "Beta s.r.o." };
    const forms: NovySpisForm[] = [
      base,
      { ...base, subject: "pravnicka-osoba", title: "Alfa s.r.o.", ico: "12345678", root: "/office/Klienti" },
      { ...base, subject: "fyzicka-osoba", title: "Ján Príkladný", root: "/office/Klienti" },
    ];
    for (const promptLanguage of ["sk", "cs"] as const) {
      for (const form of forms) expect(composePrompt({ ...form, promptLanguage })).not.toMatch(OLD);
    }
    const sk = composePrompt({ ...base, promptLanguage: "sk" });
    expect(sk).toContain("druh prípadu: dispute");
    expect(sk).toContain("Prípad vytvor pod existujúcim klientom");
    const cs = composePrompt({ ...base, promptLanguage: "cs" });
    expect(cs).toContain("druh případu: dispute");
    expect(cs).toContain("Případ vytvoř pod existujícím klientem");
  });

  test("upozornenia plánu (záložný text)", () => {
    const form: NovySpisForm = { mode: "okf", subject: "pravnicka-osoba", title: "MSPH 79 INS 1/2026", ico: "", jurisdikcia: "SK", root: "/office/Klienti", protistrana: "" };
    const notes = groupPlan([], { form, workspacePath: "" }).pozornost.map((item) => item.note ?? "");
    expect(notes).toContain("názov priečinka sa líši od názvu prípadu „MSPH 79 INS 1/2026“ — upravený na jeden segment");
    expect(notes).toContain("doplň krajinu; jurisdikcia prípadu ju nenahrádza");
    expect(notes.filter((note) => OLD.test(note))).toEqual([]);
  });

  test("texty v zdrojoch Lehôt a AI (postup lehôt, poučenie o AI) nehovoria o veci", () => {
    // Texty tu nie sú v slovníkoch (pomocník `copy`, objekt textov), preto sa číta zdroj bez komentárov.
    const root = join(import.meta.dir, "../src/lawoss/domains");
    const hits: string[] = [];
    for (const dir of ["lehoty", "ai"]) {
      for (const name of readdirSync(join(root, dir)).filter((file) => /\.tsx?$/.test(file))) {
        const code = readFileSync(join(root, dir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
        code.split("\n").forEach((line, index) => { if (OLD.test(line)) hits.push(`${dir}/${name}:${index + 1}: ${line.trim().slice(0, 120)}`); });
      }
    }
    expect(hits).toEqual([]);
  });

  test("problémy pri čítaní pamäte", async () => {
    const MATTER = "AK/N/Novák Jan/Spisy/Spor";
    const card = "---\ntype: matter\ntitle: Spor\n---\n";
    const record = (id: string) => `---\nokf: 1\nid: ${id}\ntype: task\ntitle: úloha ${id}\ndescription: syntetický záznam\nlayer: L2\njurisdiction: sk\nstatus: active\ncreated: 2026-09-01\nupdated: 2026-09-01\nstate: open\n---\n\n## Truth\n\nNič.\n\n## History\n\n- 2026-09-01 [created] — založené\n`;
    const out = await readWorkspaceMemory(fakeClient({
      [`${MATTER}/matter.md`]: card,
      [`${MATTER}/spis.md`]: card,
      [`${MATTER}/memory/T-001.md`]: record("T-001"),
      "AK/N/Novák Jan/client.md": "---\ntype: client\n---\n",
      "AK/N/Novák Jan/memory/T-001.md": record("T-001"),
    }), "ws", "2026-09-12");
    const messages = out.problems.map((problem) => problem.message);
    expect(messages.some((message) => message.startsWith("Viac kariet prípadu: "))).toBe(true);
    expect(messages.some((message) => message.includes(`v rozsahu prípadu ${MATTER}.`))).toBe(true);
    expect(messages.filter((message) => OLD.test(message))).toEqual([]);
  });
});

function fakeClient(files: Record<string, string>): OkfReadClient {
  const paths = Object.keys(files);
  return {
    listWorkspaceDirectory: async (_ws, path) => {
      const prefix = path ? `${path}/` : "";
      const names = new Map<string, "file" | "dir">();
      for (const p of paths) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const [name] = rest.split("/");
        names.set(name, rest.includes("/") ? "dir" : "file");
      }
      if (names.size === 0) throw new Error(`404 ${path}`);
      return { path, truncated: false, entries: [...names].map(([name, kind]) => ({ name, kind, path: `${prefix}${name}` })) };
    },
    readWorkspaceFile: async (_ws, path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`404 ${path}`);
      return { path, content, bytes: content.length, updatedAt: 0 };
    },
  };
}
