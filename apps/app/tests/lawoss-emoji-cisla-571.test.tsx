// LAWOSS #571: „1:2:3“ sa v chate menilo na „1🕑3“ (skratky emoji zo všetkých kľúčových slov emojilib).
import { afterAll, beforeAll, expect, test } from "bun:test";
import DOMPurify from "dompurify";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBlock } from "../src/components/markdown/markdown";
import { MarkdownBlock as SurfaceMarkdownBlock } from "../src/react-app/domains/session/surface/markdown";

beforeAll(() => Object.defineProperty(DOMPurify, "sanitize", { value: (html: string) => html, configurable: true }));
afterAll(() => { Reflect.deleteProperty(DOMPurify, "sanitize"); });

for (const [name, Component] of [["chat", MarkdownBlock], ["surface", SurfaceMarkdownBlock]] satisfies [string, typeof MarkdownBlock][]) {
  const render = (text: string) => renderToStaticMarkup(<MemoryRouter><Component text={text} streaming={false} /></MemoryRouter>);

  test(`${name}: pomery, časy, adresy a krátke slová ostanú textom`, () => {
    const html = render("Podíly v poměru 1:2:3, jednání ve 12:30:45, adresa 127.0.0.1:9:80, zákon :na: a :je: a :v: a :100:.");
    for (const literal of ["1:2:3", "12:30:45", "127.0.0.1:9:80", ":na:", ":je:", ":v:", ":100:"]) expect(html).toContain(literal);
    for (const emoji of ["🕑", "🕘", "🇳🇦", "🇯🇪", "✌", "💯"]) expect(html).not.toContain(emoji);
  });

  test(`${name}: skutočné skratky emoji fungujú ďalej`, () => {
    expect(render("Hotovo :smile: :thumbsup:")).not.toContain(":smile:");
  });
}
