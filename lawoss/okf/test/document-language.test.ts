import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CARD_FILE, ENTITY_TYPES, planEntity, parseFrontmatter, resolveDocumentLanguage, type PlanInput } from "../src/core.ts";
import { LOCALIZED_TEMPLATES } from "../src/templates.ts";
import { DEFAULT_FOLDER_ROLES, parseWorkingProfile, workingProfile } from "../src/profile.ts";
import { apply, plan, render, validate } from "../src/fs.ts";
import { run } from "../src/cli.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "okf-language-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const labels = {
  cs: { guide: "Nejprve čti", memory: "Starší paměť", inputs: "Vstupy a komunikace", channels: "Kontroly komunikace", profile: "Pracovní složky a názvy dokumentů", project: "rozhodnutí a získané zkušenosti", phase: "**Fáze:**" },
  sk: { guide: "Najprv čítaj", memory: "Staršia pamäť", inputs: "Vstupy a komunikácia", channels: "Kontroly komunikácie", profile: "Pracovné priečinky a názvy dokumentov", project: "rozhodnutia a lessons learned", phase: "**Fáza:**" },
  en: { guide: "First read", memory: "Legacy memory", inputs: "Inputs and communication", channels: "Communication checks", profile: "Working folders and document naming", project: "decisions and lessons learned", phase: "**Phase:**" },
};

for (const language of ["cs", "sk", "en"] as const) for (const jurisdiction of ["cz", "sk"] as const) for (const type of ENTITY_TYPES) {
  test(`${type}: ${language} document language is independent of ${jurisdiction} jurisdiction`, () => {
    const input: PlanInput = { type, dir: join(root, type), title: 'Původní "názov": právní věc', description: "Pôvodný obsah zostáva.",
      jurisdiction, language, date: "2026-09-22", advokat: "Původní Autor", country: "AT", clientType: "po", matterKind: "advisory", mode: "ongoing" };
    const before = JSON.stringify(input);
    const generated = planEntity(input, LOCALIZED_TEMPLATES, () => false);
    const content = (path: string): string => generated.entries.find((entry) => entry.path === path)?.content ?? "";
    expect(generated.language).toBe(language);
    expect(parseFrontmatter(content(CARD_FILE[type]))).toMatchObject({ type, title: input.title, description: input.description, language });
    if (type === "spis") expect(parseFrontmatter(content("matter.md"))).toMatchObject({ jurisdiction, matter_kind: "advisory", mode: "ongoing", advokat: input.advokat });
    expect(content("AGENTS.md")).toContain(labels[language].guide);
    expect(content("CLAUDE.md")).toBe(content("AGENTS.md"));
    expect(content("MEMORY.md")).toContain(type === "projekt" ? labels[language].project : labels[language].memory);
    if (type !== "projekt") {
      expect(content("VSTUPY.md")).toContain(labels[language].inputs);
      expect(content("KOMUNIKACNE-KANALY.md")).toContain(labels[language].channels);
      expect(content("PRACOVNY-PROFIL.md")).toContain(labels[language].profile);
      const profile = parseWorkingProfile(content("PRACOVNY-PROFIL.md"));
      expect(profile.roles).toEqual(DEFAULT_FOLDER_ROLES[language]);
      expect(profile.folders).toEqual(Object.values(DEFAULT_FOLDER_ROLES[language]));
      for (const folder of profile.folders) expect(generated.entries.some((entry) => entry.path === `${folder}/.keep`)).toBe(true);
      expect(content("AGENTS.md")).toContain("<!-- okf:protokol-zapisu:v2 -->");
      expect(content("AGENTS.md")).toContain("Truth, History");
    }
    if (type === "spis") {
      expect(content("_STATUS.md")).toContain(labels[language].phase);
      for (const block of ["parties", "facts", "deadlines", "timeline", "tasks", "documents"]) {
        expect(content("_STATUS.md")).toContain(`<!-- okf:render:${block}:start -->`);
        expect(content("_STATUS.md")).toContain(`<!-- okf:render:${block}:end -->`);
      }
    }
    expect(JSON.stringify(input)).toBe(before);
    expect(existsSync(input.dir)).toBe(false);
  });
}

test("defaults distinguish Czech jurisdiction from Czech language and reject unsupported choices", () => {
  expect(resolveDocumentLanguage(undefined, "cz")).toBe("cs");
  expect(resolveDocumentLanguage(undefined, "sk")).toBe("sk");
  expect(resolveDocumentLanguage()).toBe("sk");
  expect(resolveDocumentLanguage("en", "cz")).toBe("en");
  expect(resolveDocumentLanguage("cs", "sk")).toBe("cs");
  for (const invalid of ["cz", "de", "CS", "", true, null]) expect(() => resolveDocumentLanguage(invalid, "cz")).toThrow();
});

test("CLI --cz defaults to Czech, explicit English overrides prose and folders without changing jurisdiction", () => {
  for (const [language, extra] of [["cs", []], ["en", ["--language", "en"]]] as const) {
    const dir = join(root, language);
    const out: string[] = [];
    expect(run(["plan", "spis", dir, "--title", "Synthetic", "--cz", ...extra, "--json"], (value) => { out.push(value); })).toBe(0);
    expect(JSON.parse(out.join("\n"))).toMatchObject({ language, type: "spis" });
    expect(existsSync(dir)).toBe(false);
    expect(run(["apply", "spis", dir, "--title", "Synthetic", "--cz", ...extra], () => {})).toBe(0);
    expect(parseFrontmatter(readFileSync(join(dir, "matter.md"), "utf8"))).toMatchObject({ language, jurisdiction: "cz" });
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain(labels[language].guide);
    expect(existsSync(join(dir, DEFAULT_FOLDER_ROLES[language].drafts))).toBe(true);
    expect(validate(dir)).toEqual([]);
  }
});

test("invalid or repeated CLI language fails before writes", () => {
  for (const flags of [["--language"], ["--language", "cz"], ["--language", "de"], ["--language", "en", "--language", "cs"]]) {
    const target = join(root, "invalid");
    expect(run(["apply", "spis", target, "--title", "Synthetic", "--cz", ...flags], () => {})).toBe(2);
    expect(existsSync(target)).toBe(false);
  }
});

test("explicit saved working profile survives every document language", () => {
  const custom = workingProfile(["Původní drafty", "Důležitá pošta"], { drafts: "Původní drafty", important_mail: "Důležitá pošta" }, "{client}_{description}_{date}");
  for (const language of ["cs", "sk", "en"] as const) {
    const generated = planEntity({ type: "spis", dir: root, title: "Test", language, jurisdiction: "cz", workingProfile: custom }, LOCALIZED_TEMPLATES, () => false);
    expect(parseWorkingProfile(generated.entries.find((entry) => entry.path === "PRACOVNY-PROFIL.md")?.content ?? "")).toEqual(custom);
    expect(generated.entries.some((entry) => entry.path === "Původní drafty/.keep")).toBe(true);
  }
});

test("partial Office configuration inherits selected-language defaults, explicit folders remain authoritative", () => {
  mkdirSync(join(root, "Office"));
  writeFileSync(join(root, "Office", "okf.config"), 'document_naming: "{kind}_{description}"\n');
  const input: PlanInput = { type: "spis", dir: join(root, "matter"), title: "Test", jurisdiction: "cz", language: "en" };
  const english = plan(input);
  expect(english.entries.some((entry) => entry.path === "03_Drafts/.keep")).toBe(true);
  expect(english.entries.find((entry) => entry.path === "PRACOVNY-PROFIL.md")?.content).toContain("{kind}_{description}");
  writeFileSync(join(root, "Office", "okf.config"), 'matter_folders: ["Původní"]\nfolder_roles:\n  drafts: "Původní"\n');
  expect(plan(input).entries.some((entry) => entry.path === "Původní/.keep")).toBe(true);
  expect(plan(input).entries.some((entry) => entry.path === "03_Drafts/.keep")).toBe(false);
});

test("retrofit inherits existing card language and preserves all existing document and profile bytes", () => {
  apply(plan({ type: "spis", dir: root, title: "Original", jurisdiction: "cz", language: "en" }));
  writeFileSync(join(root, "03_Drafts", "original.txt"), "Original client content\n");
  const files = ["matter.md", "AGENTS.md", "CLAUDE.md", "_STATUS.md", "MEMORY.md", "PRACOVNY-PROFIL.md", "03_Drafts/original.txt"];
  const before = files.map((path) => readFileSync(join(root, path)));
  expect(plan({ type: "spis", dir: root, title: "Ignored", jurisdiction: "cz" }).language).toBe("en");
  expect(apply(plan({ type: "spis", dir: root, title: "Ignored", jurisdiction: "sk", language: "cs" })).created).toEqual([]);
  files.forEach((path, index) => expect(readFileSync(join(root, path))).toEqual(before[index]));
  expect(existsSync(join(root, "03_Navrhy"))).toBe(false);
});

test("legacy Czech card defaults new scaffold to Czech without rewriting its card or custom guide", () => {
  const original = "---\ntype: spis\njurisdiction: cz\ntitle: Původní spis\n---\nPůvodní obsah\n";
  const guide = "---\ntype: agents\n---\nMoje vlastní pravidla\n";
  writeFileSync(join(root, "spis.md"), original);
  writeFileSync(join(root, "AGENTS.md"), guide);
  apply(plan({ type: "spis", dir: root, title: "Ignored" }));
  expect(readFileSync(join(root, "spis.md"), "utf8")).toBe(original);
  expect(existsSync(join(root, "matter.md"))).toBe(false);
  expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(guide);
  expect(readFileSync(join(root, "VSTUPY.md"), "utf8")).toContain("Vstupy a komunikace");
  expect(readdirSync(root)).toContain("03_Navrhy");
});

test("render uses persisted language for the client index, explicit override never changes the card", () => {
  apply(plan({ type: "klient", dir: root, title: "Client", language: "en" }));
  const card = readFileSync(join(root, "client.md"), "utf8");
  render(root);
  expect(readFileSync(join(root, "index.md"), "utf8")).toContain("# Contents\n\n_(none yet)_");
  expect(run(["render", root, "--language", "cs"], () => {})).toBe(0);
  expect(readFileSync(join(root, "index.md"), "utf8")).toContain("_(zatím žádné)_");
  expect(readFileSync(join(root, "client.md"), "utf8")).toBe(card);
});
