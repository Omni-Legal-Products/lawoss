import { afterEach, describe, expect, test } from "bun:test";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentLanguagePreference, currentLocale, setLanguagePreference } from "../src/i18n";
import { welcomeText } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { OfficeStep } from "../src/lawoss/domains/onboarding/wizard/office-step";
import { wizardText } from "../src/lawoss/domains/onboarding/wizard/wizard-text";

// Bez DOM knižnice: krok sa vykreslí cez SSR a obsluha zmeny sa vyberie zo stromu prvkov (aj vnorených komponentov).
type Props = { children?: ReactNode; onChange?: () => void; type?: string; value?: string };
const expand = (node: ReactNode): ReactNode => {
  if (!isValidElement<Props>(node)) return node;
  if (typeof node.type === "function") {
    const render = node.type as (props: Props) => ReactNode;
    return expand(render(node.props));
  }
  return node;
};
const findAll = (node: ReactNode, match: (el: ReactElement<Props>) => boolean, out: ReactElement<Props>[] = []) => {
  Children.forEach(node, (child) => {
    const el = expand(child);
    if (!isValidElement<Props>(el)) return;
    if (match(el)) out.push(el);
    findAll(el.props.children, match, out);
  });
  return out;
};

const base = { version: 1 as const, lawyerName: "", jurisdiction: "sk" as const, language: "en" as const };

// Vnorené komponenty (aj s hookmi) sa rozbalia počas renderu obalu, preto sa rádiá hľadajú vnútri neho.
const renderRadios = (onSave: () => Promise<void>) => {
  let radios: ReactElement<Props>[] = [];
  const Capture = () => {
    const tree = OfficeStep({ base, locale: "en", text: wizardText("en"), jurisdictionLabels: { sk: "Slovakia", cz: "Czechia" }, busy: false, onSave });
    radios = findAll(tree, (el) => el.type === "input" && el.props.type === "radio");
    return null;
  };
  renderToStaticMarkup(<Capture />);
  return radios;
};

describe("Onboarding: jazyk rozhrania v kroku Kancelária", () => {
  afterEach(() => setLanguagePreference("system"));

  test("výber jazyka prepne rozhranie hneď, ešte pred uložením", () => {
    setLanguagePreference("en");
    let saved = 0;
    const radios = renderRadios(async () => { saved += 1; });
    expect(radios.map((radio) => radio.props.value)).toEqual(["sk", "cz", "sk", "cs", "en", "de"]);
    const slovak = radios.filter((radio) => radio.props.value === "sk")[1];
    slovak!.props.onChange!();
    expect(currentLocale()).toBe("sk");
    expect(currentLanguagePreference()).toBe("sk");
    expect(saved).toBe(0);
  });

  test("voľby jazyka a práva sú rádiá s popisom skupiny a bez mena sa pokračovať nedá", () => {
    const html = renderToStaticMarkup(<OfficeStep base={base} locale="sk" text={wizardText("sk")} jurisdictionLabels={{ sk: "Slovensko", cz: "Česko" }} busy={false} onSave={async () => {}} />);
    expect(html).toMatch(/<legend[^>]*>Právo, s ktorým pracujete<\/legend>/);
    expect(html).toMatch(/<legend[^>]*>Jazyk rozhrania<\/legend>/);
    expect(html).toContain("Slovenčina");
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Pokračovať<\/button>/);
    expect(html).toContain("Zadajte meno, potom môžete pokračovať.");
  });

  test("texty kroku sa berú zo živého jazyka, nie z uloženého profilu", () => {
    expect(welcomeText("sk")("save")).not.toBe(welcomeText("en")("save"));
    expect(wizardText("sk")("officeTitle")).not.toBe(wizardText("en")("officeTitle"));
  });
});
