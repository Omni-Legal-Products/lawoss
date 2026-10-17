import { describe, expect, test } from "bun:test";
import { parseFrontmatter } from "./frontmatter.js";

describe("inert frontmatter", () => {
  for (const tag of ["js", "JS", "javascript", "JavaScript", " javascript"]) {
    for (const prefix of ["", "\uFEFF"]) {
      test(`rejects executable ${JSON.stringify(prefix + tag)} metadata`, () => {
        const probe = globalThis as typeof globalThis & { lawossFrontmatterProbe?: boolean };
        delete probe.lawossFrontmatterProbe;
        try {
          expect(() => parseFrontmatter(`${prefix}---${tag}\r\n(globalThis.lawossFrontmatterProbe = true, {name: 'probe'})\r\n---\r\nBody`)).toThrow();
          expect(probe.lawossFrontmatterProbe).toBeUndefined();
        } finally { delete probe.lawossFrontmatterProbe; }
      });
    }
  }

  test("retains ordinary YAML, JSON, body and colon repair", () => {
    expect(parseFrontmatter("---\nname: demo\ndescription: Review: documents\n---\nBody")).toEqual({
      data: { name: "demo", description: "Review: documents" }, body: "Body",
    });
    expect(parseFrontmatter('---json\n{"name":"demo"}\n---\nBody')).toEqual({ data: { name: "demo" }, body: "Body" });
    expect(parseFrontmatter("---\ncommand: 'globalThis.lawossFrontmatterProbe = true'\n---\nBody").data.command).toBe("globalThis.lawossFrontmatterProbe = true");
    expect(parseFrontmatter("No metadata")).toEqual({ data: {}, body: "No metadata" });
  });
});
