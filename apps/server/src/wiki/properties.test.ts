import { describe, expect, test } from "bun:test";
import { ApiError } from "../errors.js";
import { markdownData } from "./markdown.js";
import { patchWikiProperties, wikiPropertiesPatchSchema, type WikiPropertiesPatch } from "./properties.js";

function fails(source: string, patch: WikiPropertiesPatch, code: string) {
  try { patchWikiProperties(source, patch); throw new Error("Expected property update rejection"); }
  catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw error;
    expect(error.status).toBe(400);
    expect(error.code).toBe(code);
  }
}

describe("Lossless wiki property updates", () => {
  test("changes one scalar without rewriting body, unknown maps, comments, BOM or CRLF delimiters", () => {
    const source = '\uFEFF---\r\n# leading\r\nstage: draft # keep stage comment\r\nactive: false\r\namount: 0\r\nmissing: null\r\nunknown: { nested: [1, 2] } # preserve formatting\r\n...\r\n# Page\r\n\r\n- A\r\n  - B\r\n\r\n|a|b|\r\n|-|-|\r\n|1|2|\r\n\r\n[[Client]]\r\n';
    expect(patchWikiProperties(source, { set: { stage: "reviewed" } })).toBe(source.replace("stage: draft", 'stage: "reviewed"'));
  });

  test("applies multiple typed changes against original offsets", () => {
    const source = '---\nfirst: "x" # first\nflag: true\ncount: 42\nnone: old\nlast: z\n---\nBody';
    const updated = patchWikiProperties(source, { set: { first: "longer value", flag: false, count: 0, none: null, last: ["[[Client]]", 2, false, null] } });
    expect(markdownData(updated).data).toEqual({ first: "longer value", flag: false, count: 0, none: null, last: ["[[Client]]", 2, false, null] });
    expect(updated).toContain('first: "longer value" # first\n');
    expect(updated.endsWith("---\nBody")).toBe(true);
  });

  test("no-op operations preserve quotes, numeric spelling, list layout and final newline", () => {
    const source = "---\nstage: 'reviewed'\namount: 0x10\ntags:\n - one\n - two\n---\n# Body\n";
    expect(patchWikiProperties(source, { set: { stage: "reviewed", amount: 16, tags: ["one", "two"] }, unset: ["absent"] })).toBe(source);
    expect(patchWikiProperties(source, {})).toBe(source);
  });

  test("updates same-length sequence items without dropping item or key comments", () => {
    const source = "---\ntags: # group\n  - one # first\n  # before second\n  - two # second\nunknown: { untouched: yes }\n---\nText\n";
    expect(patchWikiProperties(source, { set: { tags: ["one", "new"] } })).toBe(source.replace("- two # second", '- "new" # second'));
  });

  test("replaces or resizes simple sequences without consuming the next property", () => {
    for (const value of [["three"], [], "scalar", null]) {
      const source = "---\ntags:\n  - one\n  - two\nnext: true\n---\nBody";
      const updated = patchWikiProperties(source, { set: { tags: value } });
      expect(markdownData(updated).data).toEqual({ tags: value, next: true });
      expect(updated.endsWith("next: true\n---\nBody")).toBe(true);
    }
    const flow = "---\ntags: [one, two] # group\nnext: true\n---\nBody";
    expect(patchWikiProperties(flow, { set: { tags: ["three"] } })).toBe(flow.replace("[one, two]", '["three"]'));
  });

  test("null is a value and empty YAML values keep their comments when filled", () => {
    const source = "---\nempty: # keep\nother:\nnext: true\n---\nBody";
    const updated = patchWikiProperties(source, { set: { empty: "set", other: false } });
    expect(updated).toContain('empty: "set" # keep\n');
    expect(markdownData(updated).data).toEqual({ empty: "set", other: false, next: true });
    expect(markdownData(patchWikiProperties(updated, { set: { empty: null } })).data.empty).toBeNull();
  });

  test("unset removes only named fields and retains adjacent and inline comments", () => {
    const source = "---\n# keep leading\nstage: draft # keep inline\ntags: [one, two] # keep list comment\nempty: # retain nil comment\n# next property\nother: 1\n---\nBody";
    const updated = patchWikiProperties(source, { unset: ["stage", "tags", "empty", "absent"] });
    expect(markdownData(updated).data).toEqual({ other: 1 });
    for (const comment of ["# keep leading", "# keep inline", "# keep list comment", "# retain nil comment", "# next property"]) expect(updated).toContain(comment);
    expect(updated.endsWith("other: 1\n---\nBody")).toBe(true);
  });

  test("adds frontmatter to a plain file while retaining its body and single BOM", () => {
    const source = "\uFEFF# Plain\r\n\r\nOriginal body\r\n";
    const updated = patchWikiProperties(source, { set: { "Engagement stage": "discovery", tags: ["client", "[[ACME]]"] }, unset: ["absent"] });
    expect(updated).toBe('\uFEFF---\r\n"Engagement stage": "discovery"\r\n"tags": ["client","[[ACME]]"]\r\n---\r\n\r\n# Plain\r\n\r\nOriginal body\r\n');
    expect(patchWikiProperties(source, { unset: ["absent"] })).toBe(source);
  });

  test("appends fields to empty and comment-only headers without rewriting source", () => {
    expect(patchWikiProperties("---\n---\nBody", { set: { stage: "active" } })).toBe('---\n"stage": "active"\n---\nBody');
    expect(patchWikiProperties("---\n# retained\n...\nBody", { set: { active: false } })).toBe('---\n# retained\n"active": false\n...\nBody');
  });

  test("uses the header's newline style even if the body has different line endings", () => {
    const source = "---\nstage: draft\n---\nBody\r\n";
    expect(patchWikiProperties(source, { set: { active: true } })).toBe('---\nstage: draft\n"active": true\n---\nBody\r\n');
  });

  test("preserves root indentation when adding fields or removing a block sequence", () => {
    const source = "---\n  stage: draft\n  tags:\n    - one\n    - two\n  other: true\n---\nBody";
    const updated = patchWikiProperties(source, { set: { count: 0 }, unset: ["tags"] });
    expect(updated).toBe('---\n  stage: draft\n  other: true\n  "count": 0\n---\nBody');
    expect(markdownData(updated).data).toEqual({ stage: "draft", other: true, count: 0 });
  });

  test("fills empty block sequence items without joining the sequence indicator", () => {
    const source = "---\ntags:\n  -\n  - # keep empty item comment\n  - two\n---\nBody";
    const updated = patchWikiProperties(source, { set: { tags: ["first", false, "two"] } });
    expect(updated).toBe('---\ntags:\n  - "first"\n  - false # keep empty item comment\n  - two\n---\nBody');
    expect(markdownData(updated).data).toEqual({ tags: ["first", false, "two"] });
  });

  test("quotes control-like text and punctuation as JSON-safe YAML scalars", () => {
    const source = "# Body";
    const set = { "a: b": "true", numeric: "012", multiline: "a\nb", markup: '---\nkey: value\n# comment', quoted: '"quoted"' };
    const updated = patchWikiProperties(source, { set });
    expect(markdownData(updated).data).toEqual(set);
    expect(updated.endsWith("\n\n# Body")).toBe(true);
  });

  test("leaves unknown complex, anchored and tagged fields unchanged when changing another field", () => {
    const source = "---\nstage: draft\nunknown: &record { nested: [1, 2] }\nalias: *record\ntagged: !custom value\n---\nBody";
    expect(patchWikiProperties(source, { set: { stage: "active" } })).toBe(source.replace("stage: draft", 'stage: "active"'));
  });
});

describe("Property update validation", () => {
  test("rejects dangerous names for both set and unset", () => {
    for (const key of ["__proto__", "prototype", "constructor", "<<", "", "   ", "bad\nkey", "bad\0key"]) {
      fails("# Body", { set: Object.fromEntries([[key, "x"]]) }, "invalid_wiki_properties");
      fails("# Body", { unset: [key] }, "invalid_wiki_properties");
    }
    expect(wikiPropertiesPatchSchema.safeParse(JSON.parse('{"set":{"__proto__":"value"}}')).success).toBe(false);
  });

  test("rejects overlapping operations, duplicate removals, objects and non-JSON numbers", () => {
    fails("# Body", { set: { stage: "active" }, unset: ["stage"] }, "invalid_wiki_properties");
    fails("# Body", { unset: ["stage", "stage"] }, "invalid_wiki_properties");
    for (const patch of [{ set: { value: { nested: "map" } } }, { set: { value: [["nested"]] } }, { set: { value: Infinity } }, { set: { value: NaN } }, { set: { value: undefined } }, { unexpected: true }]) {
      expect(wikiPropertiesPatchSchema.safeParse(patch).success).toBe(false);
    }
  });

  test("rejects malformed, duplicate-key, ambiguous-key and non-mapping YAML", () => {
    for (const yaml of ["stage: [broken", "stage: a\nstage: b", "- list", "1: numeric", "? [complex, key]\n: value"]) {
      fails(`---\n${yaml}\n---\nBody`, { set: { stage: "active" } }, "wiki_properties_invalid_source");
    }
    fails("---\nstage: unfinished\nBody", { set: { stage: "active" } }, "wiki_properties_invalid_source");
  });

  test("rejects targeted maps, aliases, anchors, tags and folded block values", () => {
    for (const yaml of ["target: { nested: map }", "base: &value old\ntarget: *value", "target: &value old", "target: !!str old", "target: |\n  multiline", "target: >\n  folded", "target: [one, {nested: map}]", "? target\n: draft"]) {
      fails(`---\n${yaml}\n---\nBody`, { set: { target: "new" } }, "wiki_property_requires_source");
      fails(`---\n${yaml}\n---\nBody`, { unset: ["target"] }, "wiki_property_requires_source");
    }
    fails("---\n{stage: draft}\n---\nBody", { set: { stage: "active" } }, "wiki_property_requires_source");
  });

  test("rejects changes that would discard sequence item comments", () => {
    const source = "---\ntags:\n - one # preserve this\n - two\n---\nBody";
    fails(source, { set: { tags: ["one"] } }, "wiki_property_requires_source");
    fails(source, { unset: ["tags"] }, "wiki_property_requires_source");
  });

  test("a mixed valid/unsupported patch fails atomically instead of returning partial content", () => {
    const source = "---\nstage: draft\nunknown: { nested: map }\n---\nBody";
    fails(source, { set: { stage: "active", unknown: "replace" } }, "wiki_property_requires_source");
    expect(source).toContain("stage: draft");
  });
});
