import { describe, expect, test } from "bun:test";

import { planEntity, validateMarkdown, type TemplateSet } from "../../../lawoss/okf/src/core";
import { composePrompt, entityTypeFor, targetDir, type NovySpisForm } from "../src/lawoss/okf/compose-prompt";

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
  test("prompt names the skill, the gate and the verification step", () => {
    const text = composePrompt(form);
    expect(text).toContain("/novy-spis");
    expect(text).toContain("IČO: 12345678");
    expect(text).toContain("ORSR");
    expect(text).toContain("čakaj na moje potvrdenie");
    expect(text).toContain("/Users/x/Klienti/ACME s.r.o.");
  });
  test("no verification line when the switch is off or subject is not a company", () => {
    expect(composePrompt({ ...form, verify: false })).not.toContain("ORSR");
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
    expect(paths).toEqual(["klient.md", "AGENTS.md", "MEMORY.md", "CLAUDE.md", "index.md", "Spisy/.keep"]);
  });
  test("every generated concept document would pass v0.1 validation", () => {
    const plan = planEntity({ type: "spis", dir: "/s", title: "S" }, templates, () => false);
    for (const entry of plan.entries) {
      if (!entry.path.endsWith(".md")) continue;
      expect(validateMarkdown(entry.path, entry.content ?? "", true)).toBeNull();
    }
  });
});
