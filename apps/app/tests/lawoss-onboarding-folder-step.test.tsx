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
test("po založení nového priečinka návod na migráciu", () => {
  const html = renderToStaticMarkup(<FreshDoneView text={foundText("sk")} onFinish={() => undefined} />);
  expect(html).toContain("Klientov sem skopírujte");
  expect(html).toContain("Dokončiť");
});
