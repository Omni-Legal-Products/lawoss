import { expect, test } from "bun:test";
import { okfSkillRefreshNotice } from "../src/lawoss/okf/skill-refresh-notice";

test("upozornenie na ponechané úpravy skillov má správne číslo", () => {
  expect(okfSkillRefreshNotice([], "sk")).toBeNull();
  expect(okfSkillRefreshNotice(["novy-spis"], "sk")).toStartWith("Skill novy-spis obsahuje vaše úpravy, preto sme ho");
  expect(okfSkillRefreshNotice(["novy-spis", "okf-pamat"], "sk")).toStartWith("Skilly novy-spis, okf-pamat obsahujú vaše úpravy, preto sme ich");
  expect(okfSkillRefreshNotice(["a", "b"], "cs")).toStartWith("Skilly a, b obsahují");
  expect(okfSkillRefreshNotice(["a", "b"], "en")).toStartWith("Skills a, b contain your changes, so they were");
  expect(okfSkillRefreshNotice(["a"], "en")).toStartWith("Skill a contains your changes, so it was");
  expect(okfSkillRefreshNotice(["a", "b"], "de")).toStartWith("Die Skills a, b enthalten");
});
