import { afterEach, describe, expect, test } from "bun:test";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentLanguagePreference, currentLocale, setLanguagePreference } from "../src/i18n";
import { Identity, welcomeText } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";

// Bez DOM knižnice: Identity sa vykreslí cez SSR a obsluha zmeny sa vyberie zo stromu prvkov.
type Props = { children?: ReactNode; onChange?: (event: { target: { value: string } }) => void };
const findAll = (node: ReactNode, match: (el: ReactElement<Props>) => boolean, out: ReactElement<Props>[] = []) => {
  Children.forEach(node, (child) => {
    if (!isValidElement<Props>(child)) return;
    if (match(child)) out.push(child);
    findAll(child.props.children, match, out);
  });
  return out;
};
const optionValues = (select: ReactElement<Props>) =>
  findAll(select.props.children, (el) => el.type === "option").map((el) => (el.props as { value: string }).value);

const base = { version: 1 as const, lawyerName: "", jurisdiction: "sk" as const };

// Hooky v Identity potrebujú render; strom prvkov zachytí obal pri SSR renderi.
const renderIdentity = (onSave: () => Promise<void>) => {
  let tree: ReactNode = null;
  const Capture = () => {
    tree = Identity({ base, locale: "en", tr: welcomeText("en"), busy: false, onSave });
    return null;
  };
  renderToStaticMarkup(<Capture />);
  return tree;
};

describe("Onboarding: jazyk rozhrania v kroku Vy a jurisdikcia", () => {
  afterEach(() => setLanguagePreference("system"));

  test("výber jazyka prepne rozhranie hneď, ešte pred uložením", () => {
    setLanguagePreference("en");
    let saved = 0;
    const tree = renderIdentity(async () => { saved += 1; });

    const languageSelect = findAll(tree, (el) => el.type === "select" && optionValues(el).includes("de"))[0];
    expect(languageSelect).toBeDefined();
    expect(optionValues(languageSelect!)).toContain("sk");

    languageSelect!.props.onChange!({ target: { value: "sk" } });

    expect(currentLocale()).toBe("sk");
    expect(currentLanguagePreference()).toBe("sk");
    expect(saved).toBe(0);
  });

  test("texty kroku sa berú zo živého jazyka, nie z uloženého profilu", () => {
    expect(welcomeText("sk")("save")).not.toBe(welcomeText("en")("save"));
  });
});
