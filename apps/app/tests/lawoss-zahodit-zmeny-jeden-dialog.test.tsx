import { afterAll, expect, mock, test } from "bun:test";
import { act, createElement } from "react";
import type { ConfirmModalProps } from "../src/react-app/design-system/modals/confirm-modal";
import { artifactDocumentKey, discardDocumentsThen, getDocumentDiscardPrompt, registerUnsavedDocument, resolveDocumentDiscardPrompt } from "../src/react-app/domains/session/artifacts/docx-document-state";

/**
 * N-A7-16: po „Zahodiť zmeny“ pri zatváraní karty DOCX sa ukázal „druhý dialóg“ s textom
 * „Zahodiť zmeny v súbore ? …“. Druhá výzva nevzniká (bez mien sa výzva nevytvorí); išlo o ten istý
 * dialóg počas zatváracej animácie, keď už výzva bola vymazaná a meno sa vykreslilo prázdne.
 * Test vykreslí skutočný `DocumentDiscardDialog`; `ConfirmModal` počas testu len zaznamená vlastnosti
 * (bez DOM). Mimo testu obal vykreslí pôvodný `ConfirmModal`, ostatné súbory testov sa nemenia.
 */
const confirmModalPath = "../src/react-app/design-system/modals/confirm-modal";
const confirmModal = { ...(await import(confirmModalPath)) } as { ConfirmModal: (props: ConfirmModalProps) => unknown };
const OriginalConfirmModal = confirmModal.ConfirmModal;
let recorded: ConfirmModalProps[] | null = null;
mock.module(confirmModalPath, () => ({
  ...confirmModal,
  ConfirmModal: (props: ConfirmModalProps) => {
    if (!recorded) return createElement(OriginalConfirmModal as never, props);
    recorded.push(props);
    return null;
  },
}));
afterAll(() => { mock.module(confirmModalPath, () => confirmModal); });
const { DocumentDiscardDialog } = await import("../src/react-app/domains/session/artifacts/document-discard-dialog");

test("po potvrdení zahodenia ostane v zatvárajúcom sa dialógu meno súboru a druhá výzva nevznikne", async () => {
  const host = globalThis as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
  const windowBefore = Object.getOwnPropertyDescriptor(globalThis, "window");
  const actBefore = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(globalThis, "window", { value: { event: undefined, HTMLIFrameElement: class {} }, configurable: true, writable: true });
  host.IS_REACT_ACT_ENVIRONMENT = true;
  recorded = [];
  let discarded = 0, closed = 0;
  const key = artifactDocumentKey("workspace", "session", "file:/Users/advokat/Prax/Klienti/C001-Vzor/03_Drafty/01-zmluva.docx");
  const unregister = registerUnsavedDocument(key, "01-zmluva.docx", () => true, () => { discarded++; });
  try {
    const { createRoot } = await import("react-dom/client");
    const noop = () => undefined;
    const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", addEventListener: noop, removeEventListener: noop, ownerDocument: { addEventListener: noop, removeEventListener: noop } };
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(DocumentDiscardDialog)); });
    expect(recorded.at(-1)?.open).toBe(false);

    // Zatvorenie karty s neuloženými zmenami: jedna výzva s menom súboru.
    await act(async () => { discardDocumentsThen(() => { closed++; }, key); });
    const asked = recorded.at(-1)!;
    expect(asked.open).toBe(true);
    expect(String(asked.message)).toContain("01-zmluva.docx");

    // „Zahodiť zmeny“: karta sa zavrie, žiadna ďalšia výzva.
    await act(async () => { asked.onConfirm(); });
    expect(closed).toBe(1);
    expect(discarded).toBe(1);
    expect(getDocumentDiscardPrompt()).toBeNull();
    const closing = recorded.at(-1)!;
    expect(closing.open).toBe(false);
    // Dialóg ešte dobieha animáciu: musí ostať rovnaký, nie „Zahodiť zmeny v súbore ? …“.
    expect(String(closing.message)).toBe(String(asked.message));

    // Zatvorenie dialógu (onOpenChange → onCancel) po potvrdení nič nezruší ani znova nepýta.
    await act(async () => { closing.onCancel(); });
    expect(recorded.every(props => String(props.message).includes("01-zmluva.docx") || !props.open)).toBe(true);
    expect(recorded.filter((props, index) => props.open && !recorded![index - 1]?.open).length).toBe(1);
    expect(closed).toBe(1);
    await act(async () => { root.unmount(); });
  } finally {
    unregister();
    if (getDocumentDiscardPrompt()) resolveDocumentDiscardPrompt(false);
    recorded = null;
    if (windowBefore) Object.defineProperty(globalThis, "window", windowBefore); else delete host.window;
    if (actBefore) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", actBefore); else delete host.IS_REACT_ACT_ENVIRONMENT;
  }
});
