import { describe, expect, test } from "bun:test";
import { setWikiProperty, wikiPageRelations, wikiPropertyFields, wikiPropertyType } from "../src/react-app/domains/wiki/wiki-properties";

describe("wiki properties keep Markdown as the source of truth", () => {
  test("edits only a scalar range and preserves comments, Unicode, CRLF, and unknown mappings", () => {
    const source = '\uFEFF---\r\n# Firm metadata\r\n"stage": draft # retain\r\nactive: false\r\namount: 0\r\nunknown:\r\n  nested: [a, b]\r\n...\r\n\r\n# Über uns\r\n[[Client]]\r\n';
    const changed = setWikiProperty(source, "stage", "signed");
    expect(changed).toBe(source.replace("draft # retain", '"signed" # retain'));
    const fields = wikiPropertyFields(changed).fields;
    expect(fields.find(field => field.key === "active")?.value).toBe(false);
    expect(fields.find(field => field.key === "amount")?.value).toBe(0);
    expect(fields.find(field => field.key === "unknown")?.editable).toBe(false);
  });

  test("preserves types through zero, false, dates, nulls, quotes and page references", () => {
    let source = "# Body\n";
    for (const [key, value] of Object.entries({ amount: 0, active: false, date: "2026-10-11", empty: null, client: "[[Clients/A.md]]", quote: 'a: # "b"' })) source = setWikiProperty(source, key, value);
    expect(Object.fromEntries(wikiPropertyFields(source).fields.map(field => [field.key, field.value]))).toEqual({ amount: 0, active: false, date: "2026-10-11", empty: null, client: "[[Clients/A.md]]", quote: 'a: # "b"' });
    expect(source).toEndWith("# Body\n");
    expect(setWikiProperty("---\nempty:\n---\nBody", "empty", "x")).toContain('empty: "x"');
  });

  test("refuses malformed, duplicate, complex, anchored and tagged values without rewriting source", () => {
    for (const yaml of ["stage: [a,b]", "stage: &shared draft\ncopy: *shared", "stage: !!str draft", "stage: |\n  draft", "stage: draft\nstage: signed", "[a,b]", "stage: ["]) {
      expect(() => setWikiProperty(`---\n${yaml}\n---\nBody`, "stage", "signed")).toThrow();
    }
    expect(() => setWikiProperty("---\nmissing: end", "stage", "signed")).toThrow();
    expect(() => setWikiProperty("Body", "amount", NaN)).toThrow();
  });

  test("adding a field keeps existing source untouched and escaped keys remain valid", () => {
    const source = "---\n# Comment\nactive: false\n---\nBody";
    expect(setWikiProperty(source, "Follow up", "tomorrow")).toBe(source.replace("active: false\n", 'active: false\n"Follow up": "tomorrow"\n'));
    expect(wikiPropertyFields(setWikiProperty("Body", "With:colon", "yes")).fields[0].key).toBe("With:colon");
  });

  test("single page links can be selected and cleared without changing surrounding YAML or Markdown", () => {
    const source = '---\r\n# Relationships\r\nclient: "[[Clients/Alpha.md]]" # keep\r\nunknown: {nested: true}\r\n---\r\n\r\n- Original body\r\n';
    const selected = setWikiProperty(source, "client", "[[Clients/Beta.md]]");
    expect(selected).toBe(source.replace("Clients/Alpha.md", "Clients/Beta.md"));
    expect(wikiPageRelations(wikiPropertyFields(selected).fields[0].value)).toBe(true);
    expect(setWikiProperty(selected, "client", null)).toBe(source.replace('"[[Clients/Alpha.md]]"', "null"));
    expect(setWikiProperty(source, "client", "[[Clients/Alpha.md]]")).toBe(source);
  });

  test("page link arrays retain their representation when replacing a link and preserve the complete body", () => {
    const source = '---\n# Client matters\nmatters:\n  - "[[Matters/Alpha.md]]" # first\n  - \'[[Matters/Beta.md]]\'\nunknown:\n  complex: [1, {keep: yes}]\n---\n\n# Body\n| a | b |\n| - | - |\n';
    expect(wikiPropertyFields(source).fields[0]).toMatchObject({ editable: true, value: ["[[Matters/Alpha.md]]", "[[Matters/Beta.md]]"] });
    const changed = setWikiProperty(source, "matters", ["[[Matters/Gamma.md]]", "[[Matters/Beta.md]]"]);
    expect(changed).toBe(source.replace("Matters/Alpha.md", "Matters/Gamma.md"));
    expect(() => setWikiProperty(source, "matters", [])).toThrow("comments");
    expect(setWikiProperty(source, "matters", ["[[Matters/Alpha.md]]", "[[Matters/Beta.md]]"])).toBe(source);
  });

  test("page link arrays support adding, removing and clearing links without rewriting unrelated fields", () => {
    const source = '---\r\nmatters: ["[[A.md]]"] # retain\r\nstage: draft\r\n---\r\nExact body\r\n';
    const added = setWikiProperty(source, "matters", ["[[A.md]]", "[[B.md]]"]);
    expect(added).toBe(source.replace('["[[A.md]]"]', '["[[A.md]]","[[B.md]]"]'));
    expect(setWikiProperty(added, "matters", [])).toBe(source.replace('["[[A.md]]"]', "[]"));
    expect(wikiPageRelations(wikiPropertyFields(setWikiProperty(added, "matters", [])).fields[0].value)).toBe(true);
    const block = '---\nmatters:\n  - "[[A]]"\nother: 0\n---\nBody\n';
    const blockChanged = setWikiProperty(block, "matters", ["[[A]]", "[[B]]"]);
    expect(wikiPropertyFields(blockChanged).fields[0].value).toEqual(["[[A]]", "[[B]]"]);
    expect(blockChanged).toEndWith("other: 0\n---\nBody\n");
  });

  test("complex arrays and reserved keys stay outside the typed editor", () => {
    for (const yaml of ['matters: ["[[A]]", {nested: true}]', 'matters: &shared ["[[A]]"]', 'matters: [!!str "[[A]]"]']) {
      expect(wikiPropertyFields(`---\n${yaml}\n---\nBody`).fields[0].editable).toBe(false);
      expect(() => setWikiProperty(`---\n${yaml}\n---\nBody`, "matters", ["[[B]]"])).toThrow();
    }
    expect(() => setWikiProperty("Body", "__proto__", "x")).toThrow();
    expect(setWikiProperty("\uFEFFBody", "matters", [])).toStartWith('\uFEFF---\n"matters": []\n');
  });

  test("ordinary list chips preserve mixed scalar types, item comments and unrelated Markdown", () => {
    const source = '---\r\ntags:\r\n  - competition # retained\r\n  - 2025\r\n  - false\r\n  - null\r\nunknown: {nested: [a, b]}\r\n---\r\n\r\nExact **body**\r\n';
    const values = ["competition", 2025, false, null];
    expect(wikiPropertyFields(source).fields[0]).toMatchObject({ editable: true, value: values });
    expect(setWikiProperty(source, "tags", values)).toBe(source);
    expect(setWikiProperty(source, "tags", ["polling", 2025, false, null])).toBe(source.replace("competition # retained", '"polling" # retained'));
    expect(() => setWikiProperty(source, "tags", ["polling", 2025])).toThrow("comments");
    const flat = '---\ntags: ["alpha", 0, false, null]\nother: keep\n---\nBody\n';
    const changed = setWikiProperty(flat, "tags", ["alpha", 0, false, null, "new"]);
    expect(wikiPropertyFields(changed).fields[0].value).toEqual(["alpha", 0, false, null, "new"]);
    expect(changed).toEndWith("other: keep\n---\nBody\n");
    expect(wikiPropertyFields('---\ntags: [[nested], value]\n---\nBody').fields[0].editable).toBe(false);
    expect(() => setWikiProperty(flat, "tags", [NaN])).toThrow();
  });

  test("property types distinguish lists, relations, valid dates and false or zero", () => {
    expect(wikiPropertyType(["tag", 2025])).toBe("list");
    expect(wikiPropertyType([])).toBe("list");
    expect(wikiPropertyType(["[[Client.md]]"])).toBe("pages");
    expect(wikiPropertyType("[[Client.md]]")).toBe("page");
    expect(wikiPropertyType("2026-10-11")).toBe("date");
    expect(wikiPropertyType("2026-02-31")).toBe("text");
    expect(wikiPropertyType(false)).toBe("boolean");
    expect(wikiPropertyType(0)).toBe("number");
  });
});
