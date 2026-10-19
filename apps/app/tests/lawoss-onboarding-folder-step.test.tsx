import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FolderChoiceView, FreshCloudNoticeView, FreshDoneView } from "../src/lawoss/domains/onboarding/folder-step";
import { foundText } from "../src/lawoss/domains/onboarding/found-text";

test("dve veľké voľby so zlatým tlačidlom pre pripojenie", () => {
  const html = renderToStaticMarkup(<FolderChoiceView text={foundText("sk")} busy={false} onConnect={() => undefined} onFresh={() => undefined} />);
  expect(html).toContain("Pripojiť existujúci priečinok");
  expect(html).toContain("Začať nanovo");
  expect(html).toContain("lw-onb-choice");
  expect(html).toMatch(/class="lw-btn gold"[^>]*>Vybrať priečinok/);
});
test("Začať nanovo ukáže oznámenie OKF, ktoré advokát voľbou berie na vedomie", () => {
  const html = renderToStaticMarkup(<FolderChoiceView text={foundText("sk")} busy={false} onConnect={() => undefined} onFresh={() => undefined} />);
  expect(html).toContain("Do priečinka pridám niekoľko pomocných súborov");
  expect(html).toContain("AGENTS.md, CLAUDE.md, client.md, memory/, _STATUS.md");
  expect(html).toContain("Beriem na vedomie a pokračujem");
});
test("Dokončiť je počas dokončovania vypnuté", () => {
  const html = renderToStaticMarkup(<FreshDoneView text={foundText("sk")} busy onFinish={() => undefined} />);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Dokončiť/);
});
test("text pre neprázdny priečinok vo všetkých jazykoch", () => {
  expect(foundText("sk")("freshNotEmpty")).toBe("Vyberte prázdny priečinok. V okne výberu môžete vytvoriť nový.");
  expect(foundText("cs")("freshNotEmpty")).toBe("Vyberte prázdnou složku. V okně výběru můžete vytvořit novou.");
  expect(foundText("en")("freshNotEmpty")).toBe("Choose an empty folder. You can create a new one in the picker.");
  expect(foundText("de")("freshNotEmpty")).toBe("Wählen Sie einen leeren Ordner. Im Auswahlfenster können Sie einen neuen anlegen.");
});
test("po založení nového priečinka návod na migráciu", () => {
  const html = renderToStaticMarkup(<FreshDoneView text={foundText("sk")} onFinish={() => undefined} />);
  expect(html).toContain("Klientov sem skopírujte");
  expect(html).toContain("Dokončiť");
});
test("Späť je v hlavičke pri nadpise, nie až pod veľkými voľbami (MČ 19. 10.)", () => {
  const html = renderToStaticMarkup(<FolderChoiceView text={foundText("sk")} busy={false} onConnect={() => undefined} onFresh={() => undefined} nav={<button type="button">Späť</button>} />);
  const back = html.indexOf(">Späť<");
  expect(back).toBeGreaterThan(html.indexOf("Priečinok"));
  expect(back).toBeLessThan(html.indexOf("lw-onb-choices"));
});

test("Začať nanovo na zdieľanom disku: upozornenie s Pokračovať a Zrušiť (review 6d)", () => {
  const html = renderToStaticMarkup(<FreshCloudNoticeView text={foundText("sk")} kind="shared" onContinue={() => undefined} onCancel={() => undefined} />);
  expect(html).toContain("Priečinok je na zdieľanom disku. LAWOSS doň zapíše nové súbory (karty klienta, priečinky), ktoré uvidia aj kolegovia s prístupom.");
  expect(html).toMatch(/class="lw-btn gold"[^>]*>Pokračovať</);
  expect(html).toMatch(/class="lw-btn"[^>]*>Zrušiť</);
  expect(renderToStaticMarkup(<FreshCloudNoticeView text={foundText("sk")} kind="cloud" onContinue={() => undefined} onCancel={() => undefined} />)).toContain("Priečinok je v cloudovom úložisku.");
});
