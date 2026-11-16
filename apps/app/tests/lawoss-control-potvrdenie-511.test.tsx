import { afterAll, expect, mock, test } from "bun:test";
import { act, createElement, useEffect } from "react";
import type { ConfirmModalProps } from "../src/react-app/design-system/modals/confirm-modal";
import type { LegalworkControlAction, LegalworkControlResult } from "../src/react-app/shell/control/control-provider";

/**
 * #511: akcia ovládania appky s `requiresConfirmation` sa pýtala cez `window.confirm`, ktoré v Electrone
 * zablokuje celý renderer (aj odpoveď servera ovládania na `/snapshot`) a pýtalo sa ešte pred kontrolou
 * argumentov. Test vykreslí skutočný `LegalworkControlProvider`; `ConfirmModal` počas testu len zaznamená
 * vlastnosti (bez DOM), mimo testu vykreslí pôvodný.
 */
const confirmModalPath = "../src/react-app/design-system/modals/confirm-modal";
const confirmModal = { ...(await import(confirmModalPath)) } as { ConfirmModal: (props: ConfirmModalProps) => unknown };
let shown: ConfirmModalProps[] = [];
let mounted: ConfirmModalProps | undefined;
function RecordingConfirmModal(props: ConfirmModalProps) {
  shown.push(props);
  mounted = props;
  useEffect(() => () => { mounted = undefined; }, []);
  return null;
}
mock.module(confirmModalPath, () => ({ ...confirmModal, ConfirmModal: RecordingConfirmModal }));
afterAll(() => { mock.module(confirmModalPath, () => confirmModal); });
const { LegalworkControlProvider, useControlAction } = await import("../src/react-app/shell/control/control-provider");
const { MemoryRouter } = await import("react-router-dom");

type ControlApi = NonNullable<Window["__legalworkControl"]>;

function Registrar({ action }: { action: LegalworkControlAction }) {
  useControlAction(action);
  return null;
}

/** Pripojí poskytovateľa v minimálnom hostiteľovi React DOM; globály sa po teste vrátia presne tak, ako boli. */
async function withControl(action: LegalworkControlAction, run: (api: ControlApi) => Promise<void>) {
  const host = globalThis as { window?: unknown; document?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
  const windowBefore = Object.getOwnPropertyDescriptor(globalThis, "window");
  const documentBefore = Object.getOwnPropertyDescriptor(globalThis, "document");
  const actBefore = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  const blockingConfirm = () => { throw new Error("window.confirm zablokuje renderer"); };
  const fakeWindow: { event: undefined; HTMLIFrameElement: unknown; confirm: () => boolean; setTimeout: typeof setTimeout; __legalworkControl?: ControlApi } = {
    event: undefined, HTMLIFrameElement: class {}, confirm: blockingConfirm, setTimeout,
  };
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true, writable: true });
  Object.defineProperty(globalThis, "document", { value: { documentElement: { setAttribute: () => undefined } }, configurable: true, writable: true });
  host.IS_REACT_ACT_ENVIRONMENT = true;
  shown = [];
  mounted = undefined;
  try {
    const { createRoot } = await import("react-dom/client");
    const noop = () => undefined;
    const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", addEventListener: noop, removeEventListener: noop, ownerDocument: { addEventListener: noop, removeEventListener: noop } };
    const root = createRoot(container as unknown as Element);
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(LegalworkControlProvider, null, createElement(Registrar, { action }))));
    });
    const api = fakeWindow.__legalworkControl;
    if (!api) throw new Error("ovládanie appky sa nezaregistrovalo");
    await run(api);
    await act(async () => { root.unmount(); });
  } finally {
    shown = [];
    if (windowBefore) Object.defineProperty(globalThis, "window", windowBefore); else delete host.window;
    if (documentBefore) Object.defineProperty(globalThis, "document", documentBefore); else delete host.document;
    if (actBefore) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", actBefore); else delete host.IS_REACT_ACT_ENVIRONMENT;
  }
}

function deleteAction(executed: unknown[]): LegalworkControlAction {
  return {
    id: "session.delete",
    label: "Vymazať chat",
    sideEffect: "mutation",
    requiresArgs: true,
    requiresConfirmation: true,
    args: [
      { name: "sessionId", type: "string", required: true },
      { name: "confirmed", type: "boolean", required: true },
    ],
    execute: (args) => { executed.push(args); return { ok: true, deleted: true }; },
  };
}

const openDialog = () => (mounted?.open ? mounted : undefined);

async function settle(promise: Promise<LegalworkControlResult>) {
  let result: LegalworkControlResult | undefined;
  await act(async () => { result = await promise; });
  return result;
}

test("potvrdenie neblokuje appku a akcia beží až po súhlase advokáta", async () => {
  const executed: unknown[] = [];
  await withControl(deleteAction(executed), async (api) => {
    let pending!: Promise<LegalworkControlResult>;
    await act(async () => { pending = api.execute("session.delete", { sessionId: "s1", confirmed: true }); });
    const dialog = openDialog();
    expect(dialog?.title).toContain("Vymazať chat");
    expect(executed).toEqual([]);
    expect(api.snapshot().actions.map(action => action.id)).toContain("session.delete");

    await act(async () => { dialog?.onConfirm(); });
    expect(await settle(pending)).toMatchObject({ ok: true, actionId: "session.delete" });
    expect(executed).toEqual([{ sessionId: "s1", confirmed: true }]);
    expect(openDialog()).toBeUndefined();
  });
});

test("zrušenie v dialógu vráti user_cancelled a nič nevykoná", async () => {
  const executed: unknown[] = [];
  await withControl(deleteAction(executed), async (api) => {
    let pending!: Promise<LegalworkControlResult>;
    await act(async () => { pending = api.execute("session.delete", { sessionId: "s1", confirmed: true }); });
    await act(async () => { openDialog()?.onCancel(); });
    const { t } = await import("../src/i18n");
    expect(await settle(pending)).toEqual({ ok: false, actionId: "session.delete", error: t("control.user_cancelled") });
    expect(executed).toEqual([]);
    expect(openDialog()).toBeUndefined();
  });
});

test("chýbajúci povinný argument alebo confirmed: false odmietne bez dialógu", async () => {
  const executed: unknown[] = [];
  await withControl(deleteAction(executed), async (api) => {
    const missing = await settle(api.execute("session.delete", { confirmed: true }));
    expect(missing).toMatchObject({ ok: false, actionId: "session.delete" });
    const unconfirmed = await settle(api.execute("session.delete", { sessionId: "s1" }));
    expect(unconfirmed).toMatchObject({ ok: false, actionId: "session.delete" });
    const falseFlag = await settle(api.execute("session.delete", { sessionId: "s1", confirmed: false }));
    expect(falseFlag).toMatchObject({ ok: false, actionId: "session.delete" });
    expect(shown.filter(props => props.open)).toEqual([]);
    expect(executed).toEqual([]);
  });
});

test("odpojenie volajúceho počas čakajúceho potvrdenia dialóg zavrie a akcia sa nevykoná", async () => {
  const executed: unknown[] = [];
  await withControl(deleteAction(executed), async (api) => {
    let pending!: Promise<LegalworkControlResult>;
    await act(async () => {
      pending = api.execute("session.delete", { sessionId: "s1", confirmed: true }, undefined, { requestId: "r1", deadline: Date.now() + 60_000 });
    });
    const dialog = openDialog();
    expect(dialog).toBeDefined();
    await act(async () => { api.cancel("r1"); });
    const result = await settle(pending);
    expect(result?.ok).toBe(false);
    expect(openDialog()).toBeUndefined();
    await act(async () => { dialog?.onConfirm(); });
    expect(executed).toEqual([]);
  });
});

test("počas čakajúceho potvrdenia sa ďalšia akcia nespustí", async () => {
  const executed: unknown[] = [];
  await withControl(deleteAction(executed), async (api) => {
    let first!: Promise<LegalworkControlResult>;
    await act(async () => { first = api.execute("session.delete", { sessionId: "s1", confirmed: true }); });
    const second = await settle(api.execute("session.delete", { sessionId: "s2", confirmed: true }));
    expect(second).toMatchObject({ ok: false, actionId: "session.delete" });
    await act(async () => { openDialog()?.onConfirm(); });
    expect(await settle(first)).toMatchObject({ ok: true });
    expect(executed).toEqual([{ sessionId: "s1", confirmed: true }]);
  });
});
