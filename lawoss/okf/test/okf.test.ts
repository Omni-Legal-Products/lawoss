import { symlinkSkipReason } from "../../tests/symlink-capability.mts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseFrontmatter, planEntity, renderTemplate, validateMarkdown } from "../src/core.ts";
import { apply, detect, plan, render, validate } from "../src/fs.ts";
import { TEMPLATES } from "../src/templates.ts";
import { run } from "../src/cli.ts";
import { readStandingAuthorization } from "../../okf-pamat/src/config.ts";
const dirSymlinkSkip = symlinkSkipReason("dir");

let root = "";
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "okf-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("core", () => {
  test("renderTemplate fills known keys and blanks unknown ones", () => {
    expect(renderTemplate("a {{TITLE}} b {{NOPE}} c", { TITLE: "X" })).toBe("a X b  c");
  });
  test("parseFrontmatter reads simple keys and unquotes", () => {
    expect(parseFrontmatter('---\ntype: spis\nico: "123"\n---\nbody')).toEqual({ type: "spis", ico: "123" });
    expect(parseFrontmatter("no frontmatter")).toBeNull();
  });
  test("planEntity is pure: exists() decides create vs skip", () => {
    const p = planEntity({ type: "spis", dir: "/x", title: "Vec", date: "2026-09-02" }, TEMPLATES, (path) => path === "AGENTS.md");
    const byPath = Object.fromEntries(p.entries.map((e) => [e.path, e.action]));
    expect(byPath["matter.md"]).toBe("create");
    expect(byPath["AGENTS.md"]).toBe("skip");
    expect(byPath["CLAUDE.md"]).toBe("create");
    expect(p.entries.find((e) => e.path === "matter.md")?.content).toContain("type: spis");
  });
  test("validateMarkdown enforces v0.1 rules", () => {
    expect(validateMarkdown("x.md", "just text", true)?.message).toContain("type:");
    expect(validateMarkdown("x.md", "---\ntype: spis\n---\n", true)).toBeNull();
    expect(validateMarkdown("index.md", "# list", true)).toBeNull();
    expect(validateMarkdown("a/index.md", "---\nokf_version: \"0.1\"\n---\n", false)?.message).toContain("nesmie");
    expect(validateMarkdown("index.md", "---\nokf_version: \"0.1\"\ntitle: x\n---\n", true)?.message).toContain("iba okf_version");
    expect(validateMarkdown("log.md", "anything", true)).toBeNull();
  });
});

describe("fs", () => {
  test("detect on an empty folder reports no OKF and what is missing", () => {
    const d = detect(root, "klient");
    expect(d.type).toBeNull();
    expect(d.missing).toContain("client.md");
    expect(d.missing).toContain("AGENTS.md");
  });
  test("apply creates only missing files; a second apply changes nothing", () => {
    const input = { type: "klient" as const, dir: root, title: "ACME s.r.o.", ico: "12345678", date: "2026-09-02" };
    const first = apply(plan(input));
    expect(first.created).toContain("client.md");
    expect(first.created).toContain("CLAUDE.md");
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(readFileSync(join(root, "AGENTS.md"), "utf8"));
    const second = apply(plan(input));
    expect(second.created).toEqual([]);
    expect(second.skipped.length).toBe(first.created.length);
  });
  test("apply never overwrites a pre-existing file (retrofit contract)", () => {
    writeFileSync(join(root, "AGENTS.md"), "MOJE VLASTNE\n");
    apply(plan({ type: "spis", dir: root, title: "Vec", date: "2026-09-02" }));
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("MOJE VLASTNE\n");
    expect(existsSync(join(root, "matter.md"))).toBe(true);
  });
  test("a scaffolded folder validates; a hand-made one without type: does not", () => {
    apply(plan({ type: "spis", dir: root, title: "Vec", date: "2026-09-02" }));
    expect(validate(root)).toEqual([]);
    writeFileSync(join(root, "poznamka.md"), "bez frontmatteru\n");
    expect(validate(root).map((e) => e.path)).toEqual(["poznamka.md"]);
  });
  test("a folder written by hand from AGENTS.md alone passes validate (portability rule)", () => {
    // Bez CLI: advokát alebo iný harness vytvorí súbory ručne — musí to prejsť.
    writeFileSync(join(root, "spis.md"), "---\ntype: spis\ntitle: Ručne\n---\n# Ručne\n");
    writeFileSync(join(root, "AGENTS.md"), "---\ntype: agents\n---\n# Pokyny\n");
    writeFileSync(join(root, "index.md"), "- spis.md\n");
    expect(validate(root)).toEqual([]);
  });
  test("render restores exact mirror and preserves divergent content in a backup", () => {
    writeFileSync(join(root, "AGENTS.md"), "---\ntype: agents\n---\nA\n");
    expect(render(root).written).toContain("CLAUDE.md");
    writeFileSync(join(root, "CLAUDE.md"), "---\ntype: agents\n---\nUPRAVENE\n");
    const r = render(root);
    expect(r.written).toContain("CLAUDE.md");
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(readFileSync(join(root, "AGENTS.md"), "utf8"));
    const backup = r.written.find((path) => path.endsWith(".bak"));
    expect(backup).toBeDefined();
    expect(readFileSync(join(root, backup!), "utf8")).toContain("UPRAVENE");
  });
  test("render lists nested cards in index.md and keeps okf_version", () => {
    apply(plan({ type: "klient", dir: root, title: "ACME", date: "2026-09-02" }));
    mkdirSync(join(root, "Spisy", "Vec A"), { recursive: true });
    apply(plan({ type: "spis", dir: join(root, "Spisy", "Vec A"), title: "Vec A", date: "2026-09-02" }));
    render(root);
    const index = readFileSync(join(root, "index.md"), "utf8");
    expect(index).toContain('okf_version: "0.1"');
    expect(index).toContain("[Spisy/Vec A](./Spisy/Vec A/matter.md)");
  });
});

describe("cli", () => {
  const capture = () => { const lines: string[] = []; return { lines, out: (l: string) => { lines.push(l); } }; };
  test("plan writes nothing and prints + / =", () => {
    const c = capture();
    expect(run(["plan", "spis", root, "--title", "Vec", "--sk", "--json"], c.out)).toBe(0);
    const parsed = JSON.parse(c.lines.join("\n"));
    expect(parsed.entries.every((e: { content?: string }) => e.content === undefined)).toBe(true);
    expect(existsSync(join(root, "matter.md"))).toBe(false);
  });
  test("apply then validate returns 0; validate on broken folder returns 1", () => {
    expect(run(["apply", "spis", root, "--title", "Vec", "--sk"], () => {})).toBe(0);
    expect(run(["validate", root], () => {})).toBe(0);
    writeFileSync(join(root, "zle.md"), "x");
    expect(run(["validate", root], () => {})).toBe(1);
  });
  test("bad type is a usage error (exit 2)", () => {
    expect(run(["plan", "kauza", root], () => {})).toBe(2);
  });
});

describe("configured lawyer fallback (#50)", () => {
  const configure = (contents: string) => {
    const office = join(root, "Office");
    mkdirSync(office, { recursive: true });
    writeFileSync(join(office, "okf.config"), contents);
    return office;
  };
  const plannedLawyer = (dir: string, advokat?: string) => {
    const p = plan({ type: "spis", dir, title: "Synthetic matter", jurisdiction: "sk", advokat });
    return parseFrontmatter(p.entries.find((entry) => entry.path === "matter.md")?.content ?? "")?.advokat;
  };

  test("ancestor Office name is identical in plan and CLI apply, without granting permission", () => {
    const office = configure('standing_authorization: Ján Novák\n');
    const dir = join(root, "clients", "synthetic", "matters", "advisory");
    expect(plannedLawyer(dir)).toBe("Ján Novák");
    expect(existsSync(dir)).toBe(false);
    expect(run(["apply", "spis", dir, "--title", "Synthetic matter", "--sk"], () => {})).toBe(0);
    expect(parseFrontmatter(readFileSync(join(dir, "matter.md"), "utf8"))?.advokat).toBe("Ján Novák");
    expect(readStandingAuthorization(office)).toBeUndefined();
  });

  test("explicit lawyer overrides the configured name in plan and CLI apply", () => {
    configure("standing_authorization: Configured Lawyer\n");
    const dir = join(root, "matter");
    const explicit = 'Jana "Janka" Nováková';
    expect(plannedLawyer(dir, explicit)).toBe(explicit);
    expect(run(["apply", "spis", dir, "--title", "Synthetic matter", "--sk", "--advokat", explicit], () => {})).toBe(0);
    expect(parseFrontmatter(readFileSync(join(dir, "matter.md"), "utf8"))?.advokat).toBe(explicit);
  });

  test("quoted configured names round-trip quotes and backslashes", () => {
    const name = 'Ján "Jano" Novák \\ partner';
    configure(`standing_authorization: ${JSON.stringify(name)}\n`);
    expect(plannedLawyer(join(root, "matter"))).toBe(name);
    configure("standing_authorization: 'Ján ''Jano'' Novák'\n");
    expect(plannedLawyer(join(root, "matter"))).toBe("Ján 'Jano' Novák");
  });

  test("nearest Office wins and explicit name works even with an unreadable config", () => {
    configure("standing_authorization: Outer Lawyer\n");
    const office = join(root, "nested", "Office");
    mkdirSync(office, { recursive: true });
    writeFileSync(join(office, "okf.config"), "standing_authorization: Inner Lawyer\n");
    const dir = join(root, "nested", "client", "matter");
    expect(plannedLawyer(dir)).toBe("Inner Lawyer");
    rmSync(join(office, "okf.config"));
    mkdirSync(join(office, "okf.config"));
    expect(plannedLawyer(dir)).toBe("[DOPLNIT]");
    expect(plannedLawyer(dir, "Explicit Lawyer")).toBe("Explicit Lawyer");
  });

  test("missing, malformed and non-name config values preserve the placeholder", () => {
    const dir = join(root, "matter");
    expect(plannedLawyer(dir)).toBe("[DOPLNIT]");
    for (const contents of ["", "client_path: clients/*\n", "standing_authorization: \n", "standing_authorization: [Someone]\n", "standing_authorization: 123\n", "standing_authorization: null\n", "standing_authorization: true\n", 'standing_authorization: "Unclosed\n', 'standing_authorization: "Ján \\q Novák"\n', 'standing_authorization: "Ján\\nNovák"\n', "standing_authorization: Ján Novák\nbroken config\n", "standing_authorization: First\nstanding_authorization: Second\n"]) {
      configure(contents);
      expect(plannedLawyer(dir)).toBe("[DOPLNIT]");
    }
  });
});

/**
 * Kontrakt spisu proti `okf-pamat`.
 *
 * Spis, ktorý vznikne tu, musí byť použiteľný v ďalšom kroku. Tieto testy
 * strážia dve miesta, kde sa tie dve polovice OKF doteraz míňali: jurisdikciu
 * na karte veci a markery v `_STATUS.md`.
 */
describe("kontrakt spisu", () => {
  const capture = () => { const lines: string[] = []; return { lines, out: (l: string) => { lines.push(l); } }; };

  test("spis bez jurisdikcie sa nezaloží — odmietne už plan, nie až apply", () => {
    const c = capture();
    expect(run(["plan", "spis", "/x", "--title", "Vec"], c.out)).toBe(2);
    expect(c.lines.join("\n")).toContain("--sk");
  });

  test("naraz --sk aj --cz je chyba, nie tiché víťazstvo jednej", () => {
    const c = capture();
    expect(run(["plan", "spis", "/x", "--title", "Vec", "--sk", "--cz"], c.out)).toBe(2);
  });

  test("klient a projekt jurisdikciu nepotrebujú", () => {
    for (const type of ["klient", "projekt"]) {
      const c = capture();
      expect(run(["plan", type, "/x", "--title", "X", "--json"], c.out)).toBe(0);
    }
  });

  test("karta veci nesie jurisdikciu malými písmenami — tak ju číta okf-pamat", () => {
    const p = planEntity(
      { type: "spis", dir: "/x", title: "Vec", jurisdiction: "sk", date: "2026-09-02" },
      TEMPLATES,
      () => false,
    );
    const card = p.entries.find((e) => e.path === "matter.md");
    expect(card?.content).toContain("jurisdiction: sk");
  });

  test("advokát prichádza z --advokat; bez neho je v karte [DOPLNIT], nikdy meno natvrdo (#50)", () => {
    expect(run(["apply", "spis", join(root, "s"), "--title", "Vec", "--cz", "--advokat", "Novák Jan"], () => {})).toBe(0);
    const withName = readFileSync(join(root, "s", "matter.md"), "utf8");
    expect(withName).toContain('advokat: "Novák Jan"');
    expect(parseFrontmatter(withName)?.advokat).toBe("Novák Jan");
    expect(run(["apply", "spis", join(root, "bez"), "--title", "Vec", "--cz"], () => {})).toBe(0);
    expect(parseFrontmatter(readFileSync(join(root, "bez", "matter.md"), "utf8"))?.advokat).toBe("[DOPLNIT]");
  });

  test("_STATUS.md má markery pre všetkých šesť blokov, inak okf-memory sync skončí konfliktom", () => {
    const p = planEntity(
      { type: "spis", dir: "/x", title: "Vec", jurisdiction: "cz", date: "2026-09-02" },
      TEMPLATES,
      () => false,
    );
    const status = p.entries.find((e) => e.path === "_STATUS.md")?.content ?? "";
    for (const block of ["parties", "facts", "deadlines", "timeline", "tasks", "documents"]) {
      expect(status).toContain(`<!-- okf:render:${block}:start -->`);
      expect(status).toContain(`<!-- okf:render:${block}:end -->`);
    }
  });
});

describe("alpha client and two matters", () => {
  test("FO and entrepreneur keep citizenship, residence and registration country distinct", () => {
    for (const type of ["fo", "fo-podnikatel"]) {
      const dir = join(root, type);
      expect(run(["apply", "klient", dir, "--title", "Synthetic Person", "--client-type", type, "--country", "cz", "--citizenship", "sk", "--residence-country", "at"], () => {})).toBe(0);
      expect(parseFrontmatter(readFileSync(join(dir, "client.md"), "utf8"))).toMatchObject({ country: "CZ", citizenship: "SK", residence_country: "AT" });
    }
  });
  test("corporate client has shared documents and independent ongoing advisory matters", () => {
    expect(run(["apply", "klient", root, "--title", "Synthetic Company", "--client-type", "po"], () => {})).toBe(0);
    expect(existsSync(join(root, "01_Podklady"))).toBe(true);
    for (const title of ["Korporatna podpora", "Pracovne pravo"]) {
      const dir = join(root, "Spisy", title);
      expect(run(["apply", "spis", dir, "--title", title, "--klient", "Synthetic Company", "--sk", "--matter-kind", "advisory", "--mode", "ongoing"], () => {})).toBe(0);
      expect(parseFrontmatter(readFileSync(join(dir, "matter.md"), "utf8"))).toMatchObject({ matter_kind: "advisory", mode: "ongoing", sud: "", spisova_znacka: "" });
      expect(existsSync(join(dir, "PRACOVNY-PROFIL.md"))).toBe(true);
    }
    render(root);
    expect(readFileSync(join(root, "index.md"), "utf8")).toContain("Korporatna podpora");
    expect(readFileSync(join(root, "index.md"), "utf8")).toContain("Pracovne pravo");
    expect(validate(root)).toEqual([]);
  });
  test("client identity and incomplete registry provenance survive CLI creation", () => {
    expect(run(["apply", "klient", root, "--title", "Example", "--client-type", "po", "--country", "AT", "--identifier-type", "FN", "--identifier", "123x"], () => {})).toBe(0);
    const card = parseFrontmatter(readFileSync(join(root, "client.md"), "utf8"));
    expect(card?.client_type).toBe("po");
    expect(card?.country).toBe("AT");
    expect(card?.identifier).toBe("123x");
    expect(card?.registry_status).toBe("unverified");
    expect(card?.registry_retrieved_at).toBe("");
    expect(card?.registry_current_at).toBe("");
  });
  test("advisory has its own input register and folders without court or duplicate deadline ledger", () => {
    for (const name of ["Spor", "Poradenstvo"]) {
      const dir = join(root, "Spisy", name);
      expect(run(["apply", "spis", dir, "--title", name, "--sk", "--matter-kind", name === "Spor" ? "dispute" : "advisory", "--mode", name === "Spor" ? "bounded" : "ongoing"], () => {})).toBe(0);
      expect(existsSync(join(dir, "01_Podklady"))).toBe(true);
      expect(existsSync(join(dir, "05_Komunikacia", "Dolezita_posta"))).toBe(true);
      expect(readFileSync(join(dir, "VSTUPY.md"), "utf8")).toContain("pending");
      expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("BRAIN.md");
      expect(readFileSync(join(dir, "matter.md"), "utf8")).not.toContain("lehoty:");
    }
    const card = parseFrontmatter(readFileSync(join(root, "Spisy", "Poradenstvo", "matter.md"), "utf8"));
    expect(card?.matter_kind).toBe("advisory");
    expect(card?.mode).toBe("ongoing");
    expect(card?.sud).toBe("");
  });
  test("status contains no second manual tables outside generated blocks", () => {
    const status = TEMPLATES.spis["_STATUS.md"].replace(/<!-- okf:render:\w+:start -->[\s\S]*?<!-- okf:render:\w+:end -->/g, "");
    expect(status).not.toContain("|---");
  });
  test("retrofit mirrors the actual existing guide", () => {
    writeFileSync(join(root, "AGENTS.md"), "---\ntype: agents\n---\nExisting instructions\n");
    apply(plan({ type: "spis", dir: root, title: "Vec" }));
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(readFileSync(join(root, "AGENTS.md"), "utf8"));
  });
});

describe("office working profile", () => {
  const configure = (contents: string) => {
    mkdirSync(join(root, "Office"), { recursive: true });
    writeFileSync(join(root, "Office", "okf.config"), contents);
  };
  test("configured folders, roles and naming survive plan/apply and later config changes", () => {
    configure('matter_folders: ["Podklady od klienta", "Drafty", "Research", "Dolezita posta"]\nfolder_roles:\n  drafts: Drafty\n  research: Research\n  correspondence: Dolezita posta\ndocument_naming: "{date}_{kind}_{client}"\n');
    const dir = join(root, "clients", "synthetic", "matter");
    const input = { type: "spis" as const, dir, title: "Synthetic", jurisdiction: "sk" as const };
    const p = plan(input);
    expect(p.entries.some((entry) => entry.path === "Drafty/.keep")).toBe(true);
    expect(p.entries.some((entry) => entry.path === "03_Drafty/.keep")).toBe(false);
    expect(existsSync(dir)).toBe(false);
    apply(p);
    expect(detect(dir).missing).toEqual([]);
    const profile = readFileSync(join(dir, "PRACOVNY-PROFIL.md"), "utf8");
    expect(profile).toContain("{date}_{kind}_{client}");
    expect(profile).toContain("Drafty");
    writeFileSync(join(dir, "Podklady od klienta", "original.md"), "Unmodified source without frontmatter\n");
    expect(validate(dir)).toEqual([]);
    configure('matter_folders: ["Different"]\n');
    expect(apply(plan(input)).created).toEqual([]);
    expect(existsSync(join(dir, "Different"))).toBe(false);
    expect(readFileSync(join(dir, "PRACOVNY-PROFIL.md"), "utf8")).toBe(profile);
  });
  test("unsafe, conflicting and malformed profile paths fail before any write", () => {
    const dir = join(root, "matter");
    for (const contents of ['matter_folders: ["../outside"]', 'matter_folders: ["/outside"]', 'matter_folders: ["memory"]', 'matter_folders: [".opencode"]', 'matter_folders: ["spis.md/sub"]', 'matter_folders: ["matter.md/sub"]', 'matter_folders: ["client.md/sub"]', 'matter_folders: ["project.md/sub"]', 'matter_folders: ["Drafty", "drafty"]', 'matter_folders: wrong', 'folder_roles:\n  drafts: ../outside', 'document_naming: "../{date}"']) {
      configure(contents);
      expect(() => plan({ type: "spis", dir, title: "Synthetic" })).toThrow();
      expect(existsSync(dir)).toBe(false);
    }
  });
  test("retrofit preserves existing user folders and files", () => {
    mkdirSync(join(root, "Existing drafts"));
    writeFileSync(join(root, "Existing drafts", "original.docx"), "original bytes");
    apply(plan({ type: "spis", dir: root, title: "Synthetic" }));
    expect(readFileSync(join(root, "Existing drafts", "original.docx"), "utf8")).toBe("original bytes");
  });
  test("duplicate profile keys and role names are refused instead of choosing the last value", () => {
    for (const contents of ['matter_folders: ["A"]\nmatter_folders: ["B"]', 'folder_roles:\n  drafts: 03_Drafty\n  drafts: 04_Vystupy', 'folder_roles: {drafts: 03_Drafty, drafts: 04_Vystupy}']) {
      configure(contents);
      expect(() => plan({ type: "spis", dir: join(root, "matter"), title: "Synthetic" })).toThrow();
    }
  });
  test.skipIf(Boolean(dirSymlinkSkip))(`apply refuses a configured folder symlink before creating any scaffold files${dirSymlinkSkip ? ` (${dirSymlinkSkip})` : ""}`, () => {
    const outside = join(root, "outside");
    const dir = join(root, "matter");
    mkdirSync(outside);
    mkdirSync(dir);
    symlinkSync(outside, join(dir, "Drafty"), "dir");
    configure('matter_folders: ["Drafty"]\n');
    expect(() => apply(plan({ type: "spis", dir, title: "Synthetic" }))).toThrow();
    expect(existsSync(join(outside, ".keep"))).toBe(false);
    expect(existsSync(join(dir, "matter.md"))).toBe(false);
  });
});

test("both validators accept initialized matter and plain Markdown source documents", async () => {
  const { runCli } = await import("../../okf-pamat/src/cli.ts");
  expect(run(["apply", "spis", root, "--title", "Vec", "--sk"], () => {})).toBe(0);
  expect(runCli(["init", root, "--apply"]).code).toBe(0);
  expect(runCli(["sync", root, "--apply"]).code).toBe(0);
  writeFileSync(join(root, "01_Podklady", "sprava.md"), "Originál správy bez OKF hlavičky\n");
  expect(validate(root)).toEqual([]);
  expect(runCli(["validate", root]).code).toBe(0);
});

describe("YAML frontmatter preserves user text without injecting structure", () => {
  const text = 'Ján "Jano" Novák: C:\\spisy\\novy\n---\nregistry_status: verified\ntype: forged';
  const yaml = (document: string) => Bun.YAML.parse(document.split(/\r?\n---(?:\r?\n|$)/)[0].replace(/^---\r?\n/, ""));

  test("CLI writes a quoted lawyer name as one valid YAML scalar", async () => {
    const lawyer = 'Ján "Jano" Novák';
    expect(run(["apply", "spis", root, "--title", "Vec", "--sk", "--advokat", lawyer], () => {})).toBe(0);
    const card = readFileSync(join(root, "matter.md"), "utf8");
    expect(yaml(card)).toMatchObject({ advokat: lawyer, jurisdiction: "sk" });
    expect(parseFrontmatter(card)?.advokat).toBe(lawyer);
    const { runCli } = await import("../../okf-pamat/src/cli.ts");
    expect(runCli(["init", root, "--apply"]).code).toBe(0);
    expect(runCli(["validate", root]).code).toBe(0);
    expect(validate(root)).toEqual([]);
  });

  for (const type of ["klient", "spis", "projekt"] as const) {
    test(`${type}: every generated header is valid YAML and bodies retain readable text`, () => {
      const generated = planEntity({ type, dir: "/synthetic", title: text, description: text, klient: text,
        ico: text, identifier: text, identifierType: text, protistrana: text, protistranaIco: text,
        oblast: text, spzn: text, sud: text, advokat: text, jurisdiction: "sk", date: "2026-09-20" }, TEMPLATES, () => false);
      for (const entry of generated.entries.filter((entry) => entry.path.endsWith(".md"))) {
        expect(() => yaml(entry.content ?? "")).not.toThrow();
        expect(validateMarkdown(entry.path, entry.content ?? "", true)).toBeNull();
      }
      const card = generated.entries.find((entry) => entry.path === ({ klient: "client.md", spis: "matter.md", projekt: "project.md" })[type])?.content ?? "";
      expect(yaml(card)).toMatchObject({ type, title: text, description: text, tags: [], timestamp: "2026-09-20", updated: "2026-09-20" });
      expect(parseFrontmatter(card)).toMatchObject({ type, title: text, description: text });
      expect(card).toContain(`\n# ${text}\n\n${text}\n`);
      if (type === "klient") expect(yaml(card)).toMatchObject({ identifier: text, identifier_type: text, ico: text, registry_status: "unverified" });
      if (type === "spis") expect(yaml(card)).toMatchObject({ klient: text, klient_ico: text, protistrana: text, protistrana_ico: text,
        spisova_znacka: text, sud: text, advokat: text, oblast_prava: [text], jurisdiction: "sk" });
      if (type === "projekt") expect(yaml(card)).toMatchObject({ milestones: [] });
      expect(generated.entries.find((entry) => entry.path === "CLAUDE.md")?.content).toBe(generated.entries.find((entry) => entry.path === "AGENTS.md")?.content);
    });
  }

  test("names and identifiers resembling YAML types remain strings; empty areas remain an array", () => {
    const generated = planEntity({ type: "spis", dir: "/x", title: "false", description: "null", ico: "00123", klient: "123", jurisdiction: "sk" }, TEMPLATES, () => false);
    const card = generated.entries.find((entry) => entry.path === "matter.md")?.content ?? "";
    expect(yaml(card)).toMatchObject({ title: "false", description: "null", klient: "123", klient_ico: "00123", oblast_prava: [] });
  });

  test("reader decodes escaped newlines and backslashes from generated strings", () => {
    expect(parseFrontmatter(`---\ntype: spis\ntitle: ${JSON.stringify(text)}\n---\n`)?.title).toBe(text);
  });
});
