import { describe, expect, test } from "bun:test";
import { restorePristineMarkdown } from "../src/lawoss/markdown/pristine";

// #90: MDXEditor po skutočnej úprave serializuje celý dokument kanonicky, takže
// Undo vráti obsah, ale nie pôvodné bajty. Anonymný vstup podľa issue.
describe("restorePristineMarkdown (#90)", () => {
  const source = "---\ntitle: x\n---\n\nwww.example.org [reference]\n\n* original bullet\n\n\n";
  const pristine = { source, normalized: "---\ntitle: x\n---\n\nwww.example.org \\[reference]\n\n- original bullet\n" };

  test("Undo až na pôvodný dokument vráti pôvodné bajty", () => {
    expect(restorePristineMarkdown(pristine.normalized, pristine, "rich-text")).toBe(source);
  });

  test("skutočná úprava zostane úpravou", () => {
    const edited = pristine.normalized.replace("original bullet", "original bullet plus");
    expect(restorePristineMarkdown(edited, pristine, "rich-text")).toBe(edited);
  });

  test("úmyselná zmena syntaxe v source režime sa nepremapuje", () => {
    expect(restorePristineMarkdown(pristine.normalized, pristine, "source")).toBe(pristine.normalized);
    expect(restorePristineMarkdown(pristine.normalized, pristine, "diff")).toBe(pristine.normalized);
  });

  test("bez známeho pôvodného stavu nič nemení", () => {
    expect(restorePristineMarkdown("abc", null, "rich-text")).toBe("abc");
  });
});
