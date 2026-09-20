import { describe, expect, test } from "bun:test";

import { planEntity, validateMarkdown, type TemplateSet } from "../../../lawoss/okf/src/core";
import { composePrompt, entityTypeFor, jurisdictionFlag, targetDir, type NovySpisForm } from "../src/lawoss/okf/compose-prompt";

const form: NovySpisForm = {
  mode: "okf", subject: "pravnicka-osoba", title: "ACME s.r.o.", ico: "12345678",
  jurisdikcia: "SK", verify: true, root: "/Users/x/Klienti", protistrana: "",
};

describe("nový spis — požiadavka pre agenta", () => {
  test("subject maps to OKF entity type", () => {
    expect(entityTypeFor("pravnicka-osoba")).toBe("klient");
    expect(entityTypeFor("fyzicka-osoba")).toBe("klient");
    expect(entityTypeFor("spis")).toBe("spis");
    expect(entityTypeFor("projekt")).toBe("projekt");
  });
  test("target dir is root/title with trailing slashes trimmed", () => {
    expect(targetDir({ ...form, root: "/a/b/" })).toBe("/a/b/ACME s.r.o.");
    expect(targetDir({ ...form, root: "", title: "" })).toBe("[názov]");
  });
  test("an explicit folder name leaves the matter title unchanged", () => {
    const named = { ...form, subject: "spis" as const, title: "Novák — 14 C 101/2025", slug: "novak-odvolanie" };
    expect(targetDir(named)).toBe("/Users/x/Klienti/novak-odvolanie");
    expect(composePrompt(named)).toContain('--title "Novák — 14 C 101/2025"');
    expect(composePrompt(named)).toContain('okf plan spis "/Users/x/Klienti/novak-odvolanie"');
  });
  test("a supplied folder name cannot introduce traversal or nested directories", () => {
    expect(targetDir({ ...form, slug: "../other\\nested/name" })).toBe("/Users/x/Klienti/--other-nested-name");
    expect(targetDir({ ...form, slug: " .hidden" })).toBe("/Users/x/Klienti/hidden");
  });
  test("an empty folder name falls back to the readable title", () => {
    expect(targetDir({ ...form, slug: "   " })).toBe(targetDir(form));
    expect(targetDir({ ...form, slug: "." })).toBe(targetDir(form));
  });
  /**
   * Spisová značka má vždy lomítko (`MSPH 79 INS 1/2026`) a advokát ju do
   * názvu dá prakticky vždy. Bez sanitizácie sa ročník stal ďalšou
   * adresárovou úrovňou a `..` mohlo ujsť mimo koreň (#52).
   */
  test("názov priečinka je jeden segment; názov veci v karte ostáva pôvodný", () => {
    const spis: NovySpisForm = { ...form, subject: "spis", title: "Novák Jan — MSPH 79 INS 1/2026", jurisdikcia: "CZ" };
    expect(targetDir(spis)).toBe("/Users/x/Klienti/Novák Jan — MSPH 79 INS 1-2026");
    expect(targetDir({ ...form, title: "a\\b/c" })).toBe("/Users/x/Klienti/a-b-c");
    expect(targetDir({ ...form, title: "../.." })).toBe("/Users/x/Klienti/---");
    expect(targetDir({ ...form, title: " / " })).toBe("/Users/x/Klienti/-");
    // `.` by bol koreň sám, `.názov` skrytý priečinok mimo dosahu `okf validate`/`render`
    expect(targetDir({ ...form, title: "." })).toBe("/Users/x/Klienti/[názov]");
    expect(targetDir({ ...form, title: " .Novák" })).toBe("/Users/x/Klienti/Novák");
    const text = composePrompt(spis);
    expect(text).toContain(`okf plan spis "/Users/x/Klienti/Novák Jan — MSPH 79 INS 1-2026" --title "Novák Jan — MSPH 79 INS 1/2026" --cz`);
    expect(text).toContain("- názov: Novák Jan — MSPH 79 INS 1/2026");
  });
  test("prompt names the skill, the gate and the verification step", () => {
    const text = composePrompt(form);
    expect(text).toContain("/novy-spis");
    expect(text).toContain("IČO: 12345678");
    expect(text).toContain("ORSR");
    expect(text).toContain("čakaj na moje potvrdenie");
    expect(text).toContain("/Users/x/Klienti/ACME s.r.o.");
  });
  test("legacy verification switch cannot bypass client checks; internal projects need none", () => {
    expect(composePrompt({ ...form, verify: false })).toContain("ORSR");
    expect(composePrompt({ ...form, subject: "projekt" })).not.toContain("ORSR");
  });
});

describe("okf core used by the app preview", () => {
  const templates: TemplateSet = {
    klient: { "klient.md": "---\ntype: klient\ntitle: {{TITLE}}\n---\n", "AGENTS.md": "---\ntype: agents\n---\n", "MEMORY.md": "---\ntype: memory\n---\n" },
    spis: { "spis.md": "---\ntype: spis\n---\n", "_STATUS.md": "---\ntype: status\n---\n", "AGENTS.md": "---\ntype: agents\n---\n", "MEMORY.md": "---\ntype: memory\n---\n" },
    projekt: { "projekt.md": "---\ntype: projekt\n---\n", "AGENTS.md": "---\ntype: agents\n---\n", "MEMORY.md": "---\ntype: memory\n---\n" },
  };
  test("preview plan for a client lists card, AGENTS, CLAUDE mirror and index", () => {
    const paths = planEntity({ type: "klient", dir: "/k", title: "K" }, templates, () => false).entries.map((e) => e.path);
    expect(paths).toEqual(["klient.md", "AGENTS.md", "MEMORY.md", "CLAUDE.md", "index.md", "Spisy/.keep", "PRACOVNY-PROFIL.md", "00_Na_zatriedenie/.keep", "01_Podklady/.keep", "02_Resers/.keep", "03_Drafty/.keep", "04_Vystupy/.keep", "05_Komunikacia/.keep", "05_Komunikacia/Dolezita_posta/.keep"]);
  });
  test("every generated concept document would pass v0.1 validation", () => {
    const plan = planEntity({ type: "spis", dir: "/s", title: "S" }, templates, () => false);
    for (const entry of plan.entries) {
      if (!entry.path.endsWith(".md")) continue;
      expect(validateMarkdown(entry.path, entry.content ?? "", true)).toBeNull();
    }
  });
});

/**
 * Jurisdikcia vybraná v dialógu sa musí dostať až do karty veci. Cesta je
 * dlhá — formulár → požiadavka pre agenta → `okf` CLI → `spis.md` — a doteraz
 * končila hneď na prvom kroku: prompt ju spomínal len ľudsky a agent nemal
 * podľa čoho zložiť prepínač. Spis potom vznikol bez `jurisdiction:` a
 * `okf-memory init` ho odmietol.
 */
describe("jurisdikcia sa z dialógu dostane do CLI", () => {
  test("slovenská vec nesie --sk, česká --cz", () => {
    expect(jurisdictionFlag({ jurisdikcia: "SK" })).toBe("--sk");
    expect(jurisdictionFlag({ jurisdikcia: "CZ" })).toBe("--cz");
  });

  test("požiadavka pre agenta obsahuje prepínač, nie len názov krajiny", () => {
    expect(composePrompt({ ...form, jurisdikcia: "SK" })).toContain("--sk");
    expect(composePrompt({ ...form, jurisdikcia: "CZ" })).toContain("--cz");
  });

  test("hotový príkaz v požiadavke je spustiteľný tak, ako stojí", () => {
    const text = composePrompt({ ...form, subject: "spis", title: "Vec A", jurisdikcia: "CZ" });
    expect(text).toContain(`okf plan spis "/Users/x/Klienti/Vec A" --title "Vec A" --cz`);
  });
});


describe("alpha form preserves identity and matter intent", () => {
  test("foreign registration country is independent of legal jurisdiction", () => {
    const prompt = composePrompt({ ...form, country: "AT", identifierType: "FN", ico: "123x" });
    expect(prompt).toContain('--country "AT"');
    expect(prompt).toContain('--identifier-type "FN" --identifier "123x"');
    expect(prompt).toContain("--sk");
    expect(prompt).not.toContain("--ico");
    expect(prompt).toContain("unverified");
  });
  test("ongoing advisory and client survive prompt composition", () => {
    const prompt = composePrompt({ ...form, subject: "spis", matterKind: "advisory", matterMode: "ongoing", clientName: "Example" });
    expect(prompt).toContain('--matter-kind advisory --mode ongoing --klient "Example"');
    expect(prompt).toContain("VSTUPY.md");
    expect(prompt).toContain("okf-memory init");
  });
  test("shell metacharacters in user titles stay literal in proposed command", () => {
    const prompt = composePrompt({ ...form, title: 'Vec "A" $HOME `date`' });
    expect(prompt).toContain('--title "Vec \\"A\\" \\$HOME \\`date\\`"');
  });
});

 test("natural-person citizenship, residence and matter jurisdiction stay independent", () => {
  const text = composePrompt({ ...form, subject: "fyzicka-osoba", country: "DE", citizenship: "sk,cz", residenceCountry: "AT", jurisdikcia: "CZ", ico: "", identifierType: "internal" });
  expect(text).toContain('--citizenship "SK,CZ" --residence-country "AT"');
  expect(text).toContain('--country "DE"');
  expect(text).toContain('--cz');
  expect(text).toContain('Pri FO');
});

 test("draft carries the preview paths and boundary warning for CLI reconciliation", () => {
  const text = composePrompt(form, { source: "Predvolený profil", warning: "Office nad workspace", paths: ["03_Drafty/.keep"] });
  expect(text).toContain('"paths":["03_Drafty/.keep"]');
  expect(text).toContain("Office nad workspace");
  expect(text).toContain("pôvodné potvrdenie nepokrýva rozšírený plán");
});
