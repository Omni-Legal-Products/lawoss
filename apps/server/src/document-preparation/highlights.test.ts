import { expect, test } from "bun:test";
import { ocrQuoteRegions, pdfQuoteRegions, quoteRange } from "./highlights.js";

test("PDF quote spans use proportional glyph widths rather than character counts", () => {
  const widths: Record<string, number> = { i: 2, W: 10, " ": 3, e: 4, n: 5, d: 6 };
  const regions = pdfQuoteRegions({ lang: "en", styles: { fixture: { fontFamily: "fixture", ascent: .8, descent: -.2, vertical: false } },
    items: [{ str: "i WW end", dir: "ltr", width: 43, height: 10, transform: [10, 0, 0, 10, 5, 50], fontName: "fixture", hasEOL: false }] },
  { transform: [1, 0, 0, -1, 0, 100], scale: 1, width: 100, height: 100 }, "WW", (text, family, size) => {
    expect(family).toBe("fixture"); expect(size).toBe(10);
    return [...text].reduce((total, character) => total + widths[character], 0);
  });
  expect(regions).toHaveLength(1);
  expect(regions[0].x).toBeCloseTo(.1, 10);
  expect(regions[0].width).toBeCloseTo(.2, 10);
  expect(regions[0].y).toBeCloseTo(.42, 10);
  expect(regions[0].height).toBeCloseTo(.1, 10);
});

test("OCR highlights infer only the matching lines without model region IDs", () => {
  const regions = ["Unrelated clause", "Die Kündigungsfrist", "beträgt dreißig Tage.", "Another clause"].map((text, index) => ({ text, box: { x: .1, y: .1 + index * .1, width: .7, height: .05 } }));
  expect(ocrQuoteRegions(regions, "Die Kündigungsfrist\n beträgt dreißig Tage.")).toEqual([regions[1].box, regions[2].box]);
  expect(ocrQuoteRegions(regions, "Die Kündigungsfrist beträgt sechzig Tage.")).toEqual([]);
  expect(ocrQuoteRegions(regions, "")).toEqual([]);
  expect(ocrQuoteRegions([], "No position data")).toEqual([]);
});

test("quote locations preserve punctuation and only normalize layout whitespace", () => {
  const text = "Other. The fee is\n  EUR 1,000 (net). End.";
  const range = quoteRange(text, "The fee is EUR 1,000 (net).");
  expect(range && text.slice(range.start, range.end)).toBe("The fee is\n  EUR 1,000 (net).");
  expect(quoteRange(text, "The fee is EUR 2,000 (net).")).toBeNull();
  expect(quoteRange(text, "The fee is EUR 1,000 net.")).toBeNull();
});
