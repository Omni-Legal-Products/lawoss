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
  test.each(["", "50% hotovo\n", "%ZZ unrelated\n", "%2 unrelated\n", "%FF\n", "%E0%A4\n"])("final I1: encoded affected HTML is refused despite percent prose %j", prefix => {
    expect(() => rewriteSelectedMarkdownLinks("links.md", `${prefix}<a href="a%20b.pdf">doc</a>`, [{ from: "a b.pdf", to: "drafts/new.pdf" }])).toThrow();
  });
  test.each([
    String.raw`[x](old\.pdf)`,
    String.raw`[id]: old\.pdf`,
    String.raw`[x](<old\.pdf>)`,
    String.raw`[id]: <old\.pdf>`,
    "[read][id]\n" + String.raw`[id]: old\.pdf`,
    String.raw`[x](old\.%70df)`,
    String.raw`<a href="old\.pdf">doc</a>`,
  ])("final I2: escaped affected syntax is refused: %s", text => {
    expect(() => rewriteSelectedMarkdownLinks("links.md", text, [{ from: "old.pdf", to: "drafts/new.pdf" }])).toThrow();
  });
  test("final I1/I2: provably unrelated text and covered semantics remain unchanged", () => {
    const moves = [{ from: "old.pdf", to: "drafts/new.pdf" }];
    for (const text of [
      '50% hotovo %ZZ %2\n<a href="other%20file.pdf">doc</a>',
      String.raw`[x](other\.pdf)`,
      String.raw`[x](https://example.test/old\.pdf)`,
      "[read][old\\.pdf]\n[old\\.pdf]: other.pdf",
      '`unrelated\\.pdf`\n[[elsewhere.pdf|old\\.pdf]]',
    ]) expect(rewriteSelectedMarkdownLinks("links.md", text, moves)).toEqual({ content: text, rewrites: [] });
    const noMoves = '50% %FF\n' + String.raw`[x](old\.pdf)`;
    expect(rewriteSelectedMarkdownLinks("links.md", noMoves, [])).toEqual({ content: noMoves, rewrites: [] });
    expect(rewriteSelectedMarkdownLinks("links.md", '50% %ZZ\n[x](a%20b.pdf?q=1#p2)', [{ from: "a b.pdf", to: "drafts/new.pdf" }]).content).toBe('50% %ZZ\n[x](drafts/new.pdf?q=1#p2)');
  });
  test("review 1: Markdown path delimiters are encoded and unsafe wiki targets rejected", () => {
    for (const name of ["A#B", "A%B", "A[B]", "A^B"]) {
      const target = renderDocumentName(workingProfile(), { date: "bez-datumu", description: name, version: "01" }, ".pdf");
      const moves = [{ from: "drafts/old.pdf", to: `drafts/${target}` }];
      for (const text of ['[x](<../drafts/old.pdf#p2>)', '[id]: <../drafts/old.pdf?q=1#p2>']) {
        const expected = text.replace("old.pdf", encodeURIComponent(target));
        expect(rewriteSelectedMarkdownLinks("notes/n.md", text, moves).content).toBe(expected);
      }
      expect(() => rewriteSelectedMarkdownLinks("notes/n.md", '[[../drafts/old.pdf#p2|label]]', moves)).toThrow("wiki");
    }
  });
  test("review 1: bare Markdown closing delimiters encoded; wiki alias metadata normalized", () => {
    const result = rewriteSelectedMarkdownLinks("n.md", "[label](old.pdf#p2)", [{ from: "old.pdf", to: "A)B'(!.pdf" }]);
    expect(result.content).toBe("[label](A%29B%27%28%21.pdf#p2)");
    expect(renderDocumentName(workingProfile(), { date: "bez-datumu", description: "A|B", version: "01" }, ".pdf")).toBe("bez-datumu_A-B_v01.pdf");
  });
  test("review 2: entity-bearing relative paths fail closed before covered-token masking", () => {
    for (const text of ['[x](../drafts/old&#46;pdf)', '[x](<../drafts/old&#x2e;pdf#p2>)', '[id]: ../drafts/old&period;pdf', '[[../drafts/old&#46;pdf|label]]', '[x](../drafts/old&#46;pdf', '<a href="../drafts/old&#46;pdf">x</a>']) {
      expect(() => rewriteSelectedMarkdownLinks("notes/n.md", text, [{ from: "drafts/old.pdf", to: "drafts/new.pdf" }])).toThrow("entity");
    }
    const unrelated = '[x](https://example.test/?a=1&amp;b=2)';
    expect(rewriteSelectedMarkdownLinks("notes/n.md", unrelated, [{ from: "drafts/old.pdf", to: "drafts/new.pdf" }]).content).toBe(unrelated);
  });
  test("review 3: reference identifier with colon and destination text stays byte-identical", () => {
    const moves = [{ from: "old.pdf", to: "new.pdf" }];
    expect(rewriteSelectedMarkdownLinks("n.md", "[doc:old.pdf]: old.pdf", moves).content).toBe("[doc:old.pdf]: new.pdf");
    const source = '[read][doc:old.pdf]\n[doc:old.pdf]: <old.pdf#p2> "Title"';
    expect(rewriteSelectedMarkdownLinks("n.md", source, moves).content).toBe('[read][doc:old.pdf]\n[doc:old.pdf]: <new.pdf#p2> "Title"');
  });

});
