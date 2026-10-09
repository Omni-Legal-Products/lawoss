import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FolderChoiceView, FreshDoneView } from "../src/lawoss/domains/onboarding/folder-step";
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
  expect(html).toContain("Do priečinka pribudnú súbory OKF");
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
