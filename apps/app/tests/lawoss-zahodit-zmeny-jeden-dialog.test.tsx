import { afterAll, expect, mock, test } from "bun:test";
import { act, createElement, useEffect } from "react";
import type { ConfirmModalProps } from "../src/react-app/design-system/modals/confirm-modal";
import { artifactDocumentKey, discardDocumentsThen, getDocumentDiscardPrompt, registerUnsavedDocument, resolveDocumentDiscardPrompt } from "../src/react-app/domains/session/artifacts/docx-document-state";

/**
 * N-A7-16: po „Zahodiť zmeny“ pri zatváraní karty DOCX ostal viditeľný dialóg „Zahodiť zmeny v súbore ? …“
 * a dalo sa v ňom kliknúť na „Zrušiť“. Druhá výzva nevzniká; bol to ten istý `ConfirmModal` s `open=false`,
 * ktorý Base UI nechá pripojený (a klikateľný, inertné je len pozadie), kým nedobehne zatváracia animácia.
 * Test vykreslí skutočný `DocumentDiscardDialog`. `ConfirmModal` počas testu len zaznamená vlastnosti
 * a pripojenie (bez DOM); mimo testu vykreslí pôvodný, ostatné súbory testov sa nemenia.
 */
const confirmModalPath = "../src/react-app/design-system/modals/confirm-modal";
const confirmModal = { ...(await import(confirmModalPath)) } as { ConfirmModal: (props: ConfirmModalProps) => unknown };
const OriginalConfirmModal = confirmModal.ConfirmModal;
let recorded: ConfirmModalProps[] | null = null;
let mountedModals = 0;
function RecordingConfirmModal(props: ConfirmModalProps) {
  const recording = recorded !== null;
  useEffect(() => {
    if (!recording) return;
    mountedModals++;
    return () => { mountedModals--; };
  }, [recording]);
  if (!recorded) return createElement(OriginalConfirmModal as never, props);
  recorded.push(props);
  return null;
}
mock.module(confirmModalPath, () => ({ ...confirmModal, ConfirmModal: RecordingConfirmModal }));
afterAll(() => { mock.module(confirmModalPath, () => confirmModal); });
const { DocumentDiscardDialog } = await import("../src/react-app/domains/session/artifacts/document-discard-dialog");

/** Pripojí dialóg v minimálnom hostiteľovi React DOM; globály sa po teste vrátia presne tak, ako boli. */
async function withDialog(run: () => Promise<void>) {
  const host = globalThis as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
  const windowBefore = Object.getOwnPropertyDescriptor(globalThis, "window");
  const actBefore = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(globalThis, "window", { value: { event: undefined, HTMLIFrameElement: class {} }, configurable: true, writable: true });
  host.IS_REACT_ACT_ENVIRONMENT = true;
  recorded = [];
  mountedModals = 0;
  try {
    const { createRoot } = await import("react-dom/client");
    const noop = () => undefined;
    const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", addEventListener: noop, removeEventListener: noop, ownerDocument: { addEventListener: noop, removeEventListener: noop } };
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(createElement(DocumentDiscardDialog)); });
    await run();
    await act(async () => { root.unmount(); });
  } finally {
    if (getDocumentDiscardPrompt()) resolveDocumentDiscardPrompt(false);
    recorded = null;
    if (windowBefore) Object.defineProperty(globalThis, "window", windowBefore); else delete host.window;
    if (actBefore) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", actBefore); else delete host.IS_REACT_ACT_ENVIRONMENT;
  }
}

const key = artifactDocumentKey("workspace", "session", "file:/Users/advokat/Prax/Klienti/C001-Vzor/03_Drafty/01-zmluva.docx");

test("po „Zahodiť zmeny“ sa dialóg hneď odstráni a karta sa zavrie bez ďalšej výzvy", async () => {
  let discarded = 0, closed = 0;
  const unregister = registerUnsavedDocument(key, "01-zmluva.docx", () => true, () => { discarded++; });
  try {
    await withDialog(async () => {
      // Bez výzvy nie je dialóg pripojený vôbec (nič, čo by sa dalo zatvárať alebo kliknúť).
      expect(mountedModals).toBe(0);

      // Zatvorenie karty s neuloženými zmenami: jeden dialóg s menom súboru.
      await act(async () => { discardDocumentsThen(() => { closed++; }, key); });
      expect(mountedModals).toBe(1);
      const asked = recorded!.at(-1)!;
      expect(asked.open).toBe(true);
      expect(String(asked.message)).toContain("01-zmluva.docx");
      const rendersBefore = recorded!.length;

      // „Zahodiť zmeny“: karta sa zavrie a dialóg zmizne hneď, nie až po zatváracej animácii.
      await act(async () => { asked.onConfirm(); });
      expect(closed).toBe(1);
      expect(discarded).toBe(1);
      expect(getDocumentDiscardPrompt()).toBeNull();
      expect(mountedModals).toBe(0);
      // Žiadne vykreslenie zatvárajúceho sa dialógu („Zahodiť zmeny v súbore ? …“).
      expect(recorded!.slice(rendersBefore)).toEqual([]);
      expect(recorded!.every(props => props.open && String(props.message).includes("01-zmluva.docx"))).toBe(true);
    });
  } finally {
    unregister();
  }
});

test("„Zrušiť“ dialóg tiež hneď odstráni a karta ostane otvorená", async () => {
  let discarded = 0, closed = 0;
  const unregister = registerUnsavedDocument(key, "01-zmluva.docx", () => true, () => { discarded++; });
  try {
    await withDialog(async () => {
      await act(async () => { discardDocumentsThen(() => { closed++; }, key); });
      expect(mountedModals).toBe(1);
      await act(async () => { recorded!.at(-1)!.onCancel(); });
      expect(mountedModals).toBe(0);
      expect(getDocumentDiscardPrompt()).toBeNull();
      expect(closed).toBe(0);
      expect(discarded).toBe(0);
    });
  } finally {
    unregister();
  }
});
