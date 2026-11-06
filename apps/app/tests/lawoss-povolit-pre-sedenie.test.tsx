/** @jsxImportSource react */
// MČ 2. 11. 2026: karta úprav súborov a priečinka mimo chatu ponúka „Povoliť do konca konverzácie“.
// Appka si povolenie drží len v pamäti pre chat, ktorý sa pýtal; varovanie o inom klientovi sa pýta vždy.
import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React, { act } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { currentLocale, setLocale } from "../src/i18n";
import type { Client, PendingPermission, PendingQuestion } from "../src/app/types";
import { clearSessionApprovals, coveredBySessionApproval, offersSessionApproval, rememberSessionApproval } from "../src/lawoss/lite/session-approvals";
import { PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import { interactionSessionsKey, permissionKey, questionKey, type InteractionSessions } from "../src/react-app/domains/session/sync/interaction-state";
import { useSessionInteractions } from "../src/react-app/domains/session/sync/use-session-interactions";
import { getReactQueryClient } from "../src/react-app/infra/query-client";

const P = "/Users/advokat/Prax/Klienti";
const original = currentLocale();
afterEach(() => { setLocale(original); clearSessionApprovals(); });

const card = (id: string, permission: string, patterns: string[], sessionID = "ses_1", protocol: PendingPermission["protocol"] = "v2"): PendingPermission => ({
  id, sessionID, permission, patterns, metadata: {}, always: [], receivedAt: 1, protocol,
});

test("tlačidlo pri úpravách a priečinku mimo chatu, nie pri varovaní o inom klientovi ani pri karte príkazu", () => {
  expect(offersSessionApproval(card("a", "edit", [`${P}/C001/zmluva.docx`]), null)).toBe(true);
  expect(offersSessionApproval(card("b", "lawoss_file_change", ["*"]), null)).toBe(true);
  expect(offersSessionApproval(card("c", "external_directory", ["/Volumes/NAS/Spisy/*"]), null)).toBe(true);
  expect(offersSessionApproval(card("d", "external_directory", [`${P}/C002/*`]), "Priečinok patrí inému klientovi")).toBe(false);
  expect(offersSessionApproval(card("e", "bash", ["ls"]), null)).toBe(false);
  expect(offersSessionApproval(card("f", "edit", ["x"], "ses_1", "host"), null)).toBe(false);
  // Zápis do pamäte prípadu schvaľuje advokát vždy zvlášť.
  const memory = { ...card("g", "lawoss_file_change", ["Spisy/M004-SYN/memory/M004-MAT.md"]), metadata: { lawossMemory: { target: "Spisy/M004-SYN/memory/M004-MAT.md" } } };
  expect(offersSessionApproval(memory, null)).toBe(false);
  rememberSessionApproval(card("h", "edit", ["y"]));
  expect(coveredBySessionApproval(memory, ["ses_1"])).toBe(false);
});

test("povolené úpravy platia pre celý chat, priečinok len pre ten istý rozsah, iný chat sa pýta", () => {
  rememberSessionApproval(card("a", "edit", [`${P}/C001/zmluva.docx`]));
  expect(coveredBySessionApproval(card("a2", "edit", [`${P}/C001/iny.docx`]), ["ses_1"])).toBe(true);
  expect(coveredBySessionApproval(card("a3", "lawoss_file_change", ["*"]), ["ses_1"])).toBe(true);
  expect(coveredBySessionApproval(card("a4", "edit", ["x"], "ses_2"), ["ses_2"])).toBe(false);
  expect(coveredBySessionApproval(card("a5", "external_directory", ["/Volumes/NAS/*"]), ["ses_1"])).toBe(false);

  rememberSessionApproval(card("b", "external_directory", ["/Volumes/NAS/Spisy/*"]));
  expect(coveredBySessionApproval(card("b2", "external_directory", ["/Volumes/NAS/Spisy/*"]), ["ses_1"])).toBe(true);
  expect(coveredBySessionApproval(card("b3", "external_directory", ["/Volumes/NAS/Iné/*"]), ["ses_1"])).toBe(false);
  // Žiadosť podagenta pokryje povolenie otvoreného chatu.
  expect(coveredBySessionApproval(card("b4", "edit", ["y"], "ses_sub"), ["ses_sub", "ses_1"])).toBe(true);
  expect(coveredBySessionApproval(card("b5", "bash", ["ls"]), ["ses_1"])).toBe(false);
});

test("karta ukáže tlačidlo pri úprave súboru, nie pri karte, ktorá si „always“ pamätá sama", () => {
  setLocale("sk");
  const edit = renderToStaticMarkup(<PermissionApprovalPanel permission={card("e1", "edit", [`${P}/C001/zmluva.docx`])} respondPermission={() => {}} />);
  expect(edit).toContain("data-lawoss-session-approval");
  expect(edit).toContain("Povoliť do konca konverzácie");
  const webfetch = renderToStaticMarkup(<PermissionApprovalPanel permission={{ ...card("w1", "webfetch", ["https://www.slov-lex.sk/*"]), always: ["https://www.slov-lex.sk/*"] }} respondPermission={() => {}} />);
  expect(webfetch).not.toContain("data-lawoss-session-approval");
});

const withFiles = (id: string, ...operations: Array<Record<string, unknown>>): PendingPermission => ({
  ...card(id, "lawoss_file_change", ["Spisy/M001"]), metadata: { lawossFiles: operations },
});
const remove = { operation: "delete", kind: "file", from: "Spisy/M001/dodatok.txt" };
const move = { operation: "move", kind: "file", from: "a.txt", to: "Spisy/M001/a.txt" };
const rename = { operation: "move", kind: "file", from: "a.txt", to: "b.txt" };
const copy = { operation: "copy", kind: "file", from: "a.txt", to: "kopia.txt" };
const folder = { operation: "create_folder", kind: "folder", to: "Spisy/M002" };

test("zmazanie do Koša povolenie nepokryje a karta tlačidlo neponúkne, presuny a nové priečinky áno", () => {
  setLocale("sk");
  rememberSessionApproval(card("grant", "edit", ["x"]));
  for (const request of [withFiles("d1", remove), withFiles("d2", move, remove), withFiles("d3", folder, copy, { ...remove, kind: "folder" })]) {
    expect(offersSessionApproval(request, null)).toBe(false);
    expect(coveredBySessionApproval(request, ["ses_1"])).toBe(false);
    expect(renderToStaticMarkup(<PermissionApprovalPanel permission={request} respondPermission={() => {}} />)).not.toContain("data-lawoss-session-approval");
  }
  for (const request of [withFiles("k1", move), withFiles("k2", rename), withFiles("k3", folder), withFiles("k4", copy), withFiles("k5", move, folder)]) {
    expect(offersSessionApproval(request, null)).toBe(true);
    expect(coveredBySessionApproval(request, ["ses_1"])).toBe(true);
    expect(renderToStaticMarkup(<PermissionApprovalPanel permission={request} respondPermission={() => {}} />)).toContain("data-lawoss-session-approval");
  }
  // Plán, ktorý sa nedá prečítať, môže zmazanie skrývať: appka zaň neodpovie.
  for (const lawossFiles of [[], "delete", [null], [{ operation: "explode", kind: "file" }]]) {
    const unreadable = { ...card("u", "lawoss_file_change", ["*"]), metadata: { lawossFiles } };
    expect(offersSessionApproval(unreadable, null)).toBe(false);
    expect(coveredBySessionApproval(unreadable, ["ses_1"])).toBe(false);
  }
});

test("povolenie zo zmazania sa nezapamätá ani pre neskoršie úpravy", () => {
  rememberSessionApproval(withFiles("d", remove));
  expect(coveredBySessionApproval(card("e", "edit", ["x"]), ["ses_1"])).toBe(false);
});

// Klik sa bez DOM nedá spustiť, preto kontrola zdroja: samotné poradie overujú testy hooku nižšie.
test("karta si povolenie nepamätá sama, zapamätá ho až úspešná odpoveď v hooku", () => {
  const source = readFileSync(join(import.meta.dir, "../src/react-app/domains/session/chat/permission-approval-modal.tsx"), "utf8");
  expect(source).not.toContain("rememberSessionApproval(");
  expect(source).toContain("{ rememberForSession: true }");
});

// Skutočný hook s createRoot bez DOM, rovnaká hranica ako query-cache-state-mount.test.tsx.
const WS = "workspace-povolit";
const CHAT = "ses_1";
type Hook = ReturnType<typeof useSessionInteractions>;
type Probe = { latest: () => Hook; cards: Array<string | null>; unmount: () => Promise<void> };
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const settle = () => act(async () => { await tick(); });
const seed = (session: string, ...requests: PendingPermission[]) => act(async () => {
  getReactQueryClient().setQueryData(permissionKey(WS, session), requests);
  await tick();
});
const pending = (session = CHAT) => (getReactQueryClient().getQueryData<PendingPermission[]>(permissionKey(WS, session)) ?? []).map((item) => item.id);

/** Odpovede enginu; cast: hook používa len tieto dve metódy `Client`. */
function fakeEngine(answer: () => Promise<void> = async () => {}) {
  const replies: string[] = [];
  const client = {
    session: { todo: async () => ({ data: [] }) },
    v2: { session: { permission: { reply: async (input: { requestID: string; reply: string }) => {
      replies.push(`${input.requestID}:${input.reply}`);
      await answer();
      return { data: true };
    } } } },
  } as unknown as Client;
  return { client, replies };
}

function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open: () => open() };
}

async function withHook(run: (mount: (client: Client, sessionId?: string) => Promise<Probe>) => Promise<void>) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  const activity = useSessionActivityStore.getState();
  const query = getReactQueryClient();
  const open: Array<() => Promise<void>> = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { event: undefined, HTMLIFrameElement: class {} } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  try {
    const { createRoot } = await import("react-dom/client");
    const noop = () => undefined;
    const mount = async (client: Client, sessionId = CHAT): Promise<Probe> => {
      // Sondy nevykresľujú žiadne uzly, preto stačí hranica koreňa a udalostí Reactu.
      const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", addEventListener: noop, removeEventListener: noop, ownerDocument: { addEventListener: noop, removeEventListener: noop } };
      const root = createRoot(container as unknown as Element);
      const cards: Array<string | null> = [];
      let latest: Hook | null = null;
      function Sonda() {
        const hook = useSessionInteractions({ client, workspaceId: WS, sessionId, workspaceRoot: "/Prax/Klienti/C001" });
        latest = hook;
        cards.push(hook.activePermission?.id ?? null);
        return null;
      }
      let mounted = true;
      const unmount = async () => {
        if (!mounted) return;
        mounted = false;
        await act(async () => { root.unmount(); });
      };
      open.push(unmount);
      await act(async () => { root.render(<QueryClientProvider client={query}><Sonda /></QueryClientProvider>); });
      await settle();
      return { latest: () => { if (!latest) throw new Error("hook nebežal"); return latest; }, cards, unmount };
    };
    await run(mount);
  } finally {
    try {
      for (const unmount of open) await unmount();
      query.removeQueries({ predicate: ({ queryKey }) => queryKey.includes(WS) });
      await tick();
    } finally {
      useSessionActivityStore.setState({ recordsByWorkspaceId: activity.recordsByWorkspaceId, statusesByWorkspaceId: activity.statusesByWorkspaceId });
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
      if (originalAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalAct); else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
  }
}

test("hook: pokrytá žiadosť dostane jedno „once“, nikdy kartu, a klik počas odpovede druhú odpoveď nepošle", () => withHook(async (mount) => {
  rememberSessionApproval(card("grant", "edit", ["x"]));
  const slow = gate();
  const engine = fakeEngine(() => slow.opened);
  await seed(CHAT, card("r1", "edit", ["zmluva.docx"]));
  const hook = await mount(engine.client);
  expect(engine.replies).toEqual(["r1:once"]);
  expect(hook.cards.every((id) => id === null)).toBe(true);
  // Pomalý počítač: odpoveď ešte čaká na engine a advokát klikne na Zamietnuť.
  await act(async () => { void hook.latest().respondPermission("r1", "reject"); await tick(); });
  expect(engine.replies).toEqual(["r1:once"]);
  expect(pending()).toEqual(["r1"]);
  slow.open();
  await settle();
  expect(pending()).toEqual([]);
  expect(hook.cards.every((id) => id === null)).toBe(true);
  expect(engine.replies).toEqual(["r1:once"]);
}));

test("hook: dva otvorené chaty a znovuotvorenie počas odpovede pošlú stále jednu odpoveď", () => withHook(async (mount) => {
  const SUB = "ses_sub";
  const sessions: InteractionSessions = { [SUB]: { id: SUB, parentID: CHAT, title: "Podagent" } };
  getReactQueryClient().setQueryData(interactionSessionsKey(WS), sessions);
  rememberSessionApproval(card("grant", "edit", ["x"], SUB));
  const slow = gate();
  const engine = fakeEngine(() => slow.opened);
  await seed(SUB, card("r1", "edit", ["zmluva.docx"], SUB));
  const parent = await mount(engine.client, CHAT);
  const child = await mount(engine.client, SUB);
  expect(engine.replies).toEqual(["r1:once"]);
  await child.unmount();
  const again = await mount(engine.client, SUB);
  expect(engine.replies).toEqual(["r1:once"]);
  expect([...parent.cards, ...child.cards, ...again.cards].every((id) => id === null)).toBe(true);
  slow.open();
  await settle();
  expect(pending(SUB)).toEqual([]);
  expect(engine.replies).toEqual(["r1:once"]);
}));

test("hook: otázka za pokrytou žiadosťou sa ukáže hneď, nečaká na odpoveď enginu", () => withHook(async (mount) => {
  rememberSessionApproval(card("grant", "edit", ["x"]));
  const slow = gate();
  const engine = fakeEngine(() => slow.opened);
  const question: PendingQuestion = { id: "q1", sessionID: CHAT, questions: [], receivedAt: 2, protocol: "v2" };
  getReactQueryClient().setQueryData(questionKey(WS, CHAT), [question]);
  await seed(CHAT, card("r1", "edit", ["zmluva.docx"]));
  const hook = await mount(engine.client);
  expect(hook.latest().activePermission).toBeNull();
  expect(hook.latest().activeQuestion?.id).toBe("q1");
  slow.open();
  await settle();
}));

test("hook: nepokryté žiadosti sa ukážu a appka za ne neodpovie", () => withHook(async (mount) => {
  const grantEdit = () => rememberSessionApproval(card("g", "edit", ["x"]));
  const uncovered: Array<[PendingPermission, () => void]> = [
    [card("c1", "edit", ["zmluva.docx"]), () => rememberSessionApproval(card("g", "edit", ["x"], "ses_iny"))],
    [card("c2", "external_directory", ["/Volumes/NAS/Iné/*"]), () => rememberSessionApproval(card("g", "external_directory", ["/Volumes/NAS/Spisy/*"]))],
    [{ ...card("c3", "lawoss_file_change", ["Spisy/M004-SYN/memory/M004-MAT.md"]), metadata: { lawossMemory: { target: "Spisy/M004-SYN/memory/M004-MAT.md" } } }, grantEdit],
    [withFiles("c4", remove), grantEdit],
    [withFiles("c5", move, remove), grantEdit],
  ];
  for (const [request, grant] of uncovered) {
    clearSessionApprovals();
    grant();
    const engine = fakeEngine();
    await seed(CHAT, request);
    const hook = await mount(engine.client);
    expect(hook.latest().activePermission?.id).toBe(request.id);
    expect(engine.replies).toEqual([]);
    expect(pending()).toEqual([request.id]);
    await hook.unmount();
    await seed(CHAT);
  }
  // Kontrola: pri rovnakom povolení presun appka odpovie sama, takže výnimky vyššie nie sú náhoda.
  clearSessionApprovals();
  grantEdit();
  const engine = fakeEngine();
  await seed(CHAT, withFiles("k1", move));
  const hook = await mount(engine.client);
  expect(engine.replies).toEqual(["k1:once"]);
  expect(hook.latest().activePermission).toBeNull();
}));

test("hook: keď automatická odpoveď zlyhá, advokát dostane kartu a appka to neskúša znova", () => withHook(async (mount) => {
  rememberSessionApproval(card("grant", "edit", ["x"]));
  let fail = true;
  const engine = fakeEngine(async () => { if (fail) throw new Error("engine neodpovedá"); });
  await seed(CHAT, card("r1", "edit", ["zmluva.docx"]));
  const hook = await mount(engine.client);
  await settle();
  expect(engine.replies).toEqual(["r1:once"]);
  expect(hook.latest().activePermission?.id).toBe("r1");
  await seed(CHAT, card("r1", "edit", ["zmluva.docx"]), { ...card("r2", "bash", ["ls"]), receivedAt: 2 });
  expect(engine.replies).toEqual(["r1:once"]);
  fail = false;
  await act(async () => { await hook.latest().respondPermission("r1", "reject"); });
  expect(engine.replies).toEqual(["r1:once", "r1:reject"]);
  expect(pending()).toEqual(["r2"]);
}));

test("hook: „do konca konverzácie“ platí až po úspešnej odpovedi a pokryje ďalšiu čakajúcu žiadosť", () => withHook(async (mount) => {
  let fail = true;
  const engine = fakeEngine(async () => { if (fail) throw new Error("engine neodpovedá"); });
  await seed(CHAT, card("r1", "edit", ["a.docx"]), { ...card("r2", "edit", ["b.docx"]), receivedAt: 2 });
  const hook = await mount(engine.client);
  expect(hook.latest().activePermission?.id).toBe("r1");
  await act(async () => { await hook.latest().respondPermission("r1", "once", { rememberForSession: true }); });
  expect(coveredBySessionApproval(card("x", "edit", ["c.docx"]), [CHAT])).toBe(false);
  expect(engine.replies).toEqual(["r1:once"]);
  expect(hook.latest().activePermission?.id).toBe("r1");
  fail = false;
  await act(async () => { await hook.latest().respondPermission("r1", "once", { rememberForSession: true }); });
  await settle();
  expect(coveredBySessionApproval(card("x", "edit", ["c.docx"]), [CHAT])).toBe(true);
  expect(engine.replies).toEqual(["r1:once", "r1:once", "r2:once"]);
  expect(pending()).toEqual([]);
  expect(hook.latest().activePermission).toBeNull();
  expect(hook.cards).not.toContain("r2");
}));

test("hook: obyčajné „once“ povolenie nezapamätá", () => withHook(async (mount) => {
  const engine = fakeEngine();
  await seed(CHAT, card("r1", "edit", ["a.docx"]));
  const hook = await mount(engine.client);
  await act(async () => { await hook.latest().respondPermission("r1", "once"); });
  await settle();
  expect(engine.replies).toEqual(["r1:once"]);
  expect(coveredBySessionApproval(card("x", "edit", ["c.docx"]), [CHAT])).toBe(false);
}));
