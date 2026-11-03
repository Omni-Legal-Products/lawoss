import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { t } from "@/i18n";
import { ConfirmModal } from "../src/react-app/design-system/modals/confirm-modal";
import { GlobalRemoveAction } from "../src/lawoss/domains/marketplace/native-catalog";

// #255 (N-A3-4): „Odinštalovať pre všetkých klientov“ v katalógu LAWOSS Marketplace odstránilo doplnok
// hneď po kliknutí. Odstránenie zo všetkých klientov je nevratný krok, preto ho advokát najprv potvrdí.

type Props = { onClick?: () => void; children?: ReactNode };

/** Prvý prvok v strome, ktorý spĺňa podmienku; funkčné komponenty sa nevolajú (bez DOM). */
function findElement(node: ReactNode, match: (element: ReactElement<Props>) => boolean): ReactElement<Props> | null {
  if (Array.isArray(node)) {
    for (const child of node) { const found = findElement(child, match); if (found) return found; }
    return null;
  }
  if (!isValidElement<Props>(node)) return null;
  if (match(node)) return node;
  return findElement(node.props.children, match);
}

function action(confirming: boolean) {
  const calls: string[] = [];
  const view = GlobalRemoveAction({
    name: "Slov-Lex", locale: "sk", disabled: false, confirming,
    onRequest: () => calls.push("request"), onCancel: () => calls.push("cancel"), onConfirm: () => calls.push("remove"),
  });
  const button = findElement(view, (element) => typeof element.props.onClick === "function");
  const modal = findElement(view, (element) => element.type === ConfirmModal) as ReactElement<Parameters<typeof ConfirmModal>[0]> | null;
  return { view, calls, button, modal };
}

describe("odinštalovanie doplnku pre všetkých klientov", () => {
  test("kliknutie na tlačidlo len otvorí potvrdenie, nič neodstráni", () => {
    const { calls, button, modal } = action(false);
    expect(modal?.props.open).toBe(false);
    button?.props.onClick?.();
    expect(calls).toEqual(["request"]);
  });

  test("potvrdenie pomenuje doplnok a odstráni ho až po potvrdení; Zrušiť nič neodstráni", () => {
    const { calls, modal } = action(true);
    expect(modal?.props.open).toBe(true);
    expect(modal?.props.variant).toBe("danger");
    expect(modal?.props.title).toBe("Odinštalovať Slov-Lex pre všetkých klientov?");
    expect(modal?.props.confirmLabel).toBe("Odinštalovať pre všetkých klientov");
    expect(modal?.props.cancelLabel).toBe("Zrušiť");
    modal?.props.onCancel();
    expect(calls).toEqual(["cancel"]);
    modal?.props.onConfirm();
    expect(calls).toEqual(["cancel", "remove"]);
  });

  test("tlačidlo sa vykreslí s pôvodným textom a dá sa vypnúť", () => {
    const html = renderToStaticMarkup(<GlobalRemoveAction name="Slov-Lex" locale="en" disabled confirming={false}
      onRequest={() => undefined} onCancel={() => undefined} onConfirm={() => undefined} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Uninstall for all clients<\/button>/);
  });

  test("texty potvrdenia sú v SK, CS, EN a DE", () => {
    for (const language of ["sk", "cs", "en", "de"] as const) {
      expect(t("lawoss.marketplace.remove.confirm_title", language, { name: "X" })).toContain("X");
      expect(t("lawoss.marketplace.remove.confirm_description", language)).not.toBe("lawoss.marketplace.remove.confirm_description");
    }
  });
});
