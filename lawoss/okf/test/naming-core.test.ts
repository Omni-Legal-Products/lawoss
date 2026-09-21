import { describe, expect, test } from "bun:test";
import { parseNamingRequest, renderDocumentName, rewriteSelectedMarkdownLinks, namingFingerprint } from "../src/naming-core.ts";
import { workingProfile } from "../src/profile.ts";
const request = () => ({ schema: "lawoss.document-naming.request/v1", operationId: "op-1", documents: [{ id: "d1", path: "03_Drafty/old.PDF", treatment: "rename-working", destinationRole: "drafts", metadata: { date: "bez-datumu", description: "Návrh / zmluva", version: "01" } }], markdownFiles: [] });
describe("bounded naming core", () => {
  test("explicit metadata, normalization and exact extension", () => {
    const r = parseNamingRequest(request());
    expect(renderDocumentName(workingProfile(), r.documents[0]!.metadata, ".PDF")).toBe("bez-datumu_Návrh-zmluva_v01.PDF");
    for (const date of ["2026-02-29", "2026-04-31", "2026-1-01", "mtime", "0000-01-01"]) {
      const r = request(); r.documents[0]!.metadata.date = date; expect(() => parseNamingRequest(r)).toThrow();
    }
    const r2 = request(); r2.documents[0]!.metadata.date = "2024-02-29"; expect(parseNamingRequest(r2).documents).toHaveLength(1);
    expect(() => renderDocumentName(workingProfile(), { date: "bez-datumu" }, ".pdf")).toThrow();
  });
  test("portable paths and bounded selection", () => {
    for (const path of ["../a.pdf", "/a.pdf", "C:/a.pdf", "C:a.pdf", "a\\b.pdf", "a//b.pdf", "a/CON.pdf", "a/CONIN$.pdf", "//host/share/a.pdf", "a/foo. ", "a/\u0000.pdf", "a/.hidden"]) {
      const r = request(); r.documents[0]!.path = path; expect(() => parseNamingRequest(r)).toThrow();
    }
    const invalidId = request(); invalidId.operationId = "CON"; expect(() => parseNamingRequest(invalidId)).toThrow();
    const tooMany = { ...request(), markdownFiles: Array.from({ length: 33 }, (_, i) => `notes/${i}.md`) }; expect(() => parseNamingRequest(tooMany)).toThrow();
    const r = request(); r.documents = Array.from({ length: 65 }, (_, i) => ({ ...r.documents[0]!, id: `d${i}`, path: `draft/${i}.pdf` })); expect(() => parseNamingRequest(r)).toThrow();
  });
  test("supported links keep labels, fragments, query and angle style", () => {
    const text = '[label](../03_Drafty/old.PDF#p2) ![image](<../03_Drafty/old.PDF?q=1#p3> "title")\n[id]: ../03_Drafty/old.PDF#p4\n[[../03_Drafty/old.PDF#Heading|label]]\n[original](../01_Podklady/original.pdf)';
    const result = rewriteSelectedMarkdownLinks("notes/note.md", text, [{ from: "03_Drafty/old.PDF", to: "03_Drafty/new.PDF" }]);
    expect(result.content).toBe(text.replaceAll("old.PDF", "new.PDF")); expect(result.rewrites).toHaveLength(4);
  });
  test("affected ambiguous syntax fails closed; unrelated bytes unchanged", () => {
    for (const text of ['[x](../03_Drafty/old.PDF', '`[x](../03_Drafty/old.PDF)`', '[[old.PDF]]', '<a href="../03_Drafty/old.PDF">x</a>', '<!-- [x](../03_Drafty/old.PDF) -->', '    [x](../03_Drafty/old.PDF)', '[id]: ../03_Drafty/old.PDF\n[id]: elsewhere.pdf']) expect(() => rewriteSelectedMarkdownLinks("notes/n.md", text, [{ from: "03_Drafty/old.PDF", to: "03_Drafty/new.PDF" }])).toThrow();
    expect(rewriteSelectedMarkdownLinks("note.md", "[x](https://example.test/foo)\r\n", []).content).toBe("[x](https://example.test/foo)\r\n");
  });
  test("canonical fingerprints ignore object key insertion order", () => {
    expect(namingFingerprint({ b: 1, a: { y: 2, x: 3 } })).toBe(namingFingerprint({ a: { x: 3, y: 2 }, b: 1 }));
  });
});
