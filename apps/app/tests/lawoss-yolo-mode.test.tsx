import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";
import {
  parseYoloMode, publishYoloMode, requestYoloChange, saveYoloMode, YoloBadge, YoloBadgeView, YoloModeRowView, yoloTurnContext,
} from "../src/lawoss/domains/yolo/yolo-mode";

const noop = () => {};
const off = {enabled: false, locked: false, source: "default"} as const;
const on = {enabled: true, locked: false, source: "user"} as const;
const locked = {enabled: false, locked: true, source: "organization"} as const;
const row = (props: Partial<Parameters<typeof YoloModeRowView>[0]>) => renderToStaticMarkup(
  <YoloModeRowView locale="sk" mode={off} canWrite busy={false} confirming={false} failed={false} onRequestChange={noop} onConfirm={noop} onCancel={noop} {...props} />);

test("YOLO Mode is a native row, off by default, with a short Slovak subtitle", () => {
  const html = row({});
  expect(html).toContain(">YOLO Mode<");
  expect(html).toContain("Agent pracuje so súbormi a príkazmi sám, bez pýtania.");
  expect(html).toContain('data-lawoss-yolo="off"');
  expect(html).toContain('aria-checked="false"');
  expect(html).not.toContain('data-disabled=""');
  expect(html).not.toContain('role="alertdialog"');
  // Switching off also waits for the engine reload, so the note shows in both states.
  expect(html).toContain("Prejaví sa bez reštartu appky");
  expect(row({mode: null})).not.toContain("Prejaví sa bez reštartu appky");
});

test("switching on only asks for an in-page confirmation; switching off saves at once", () => {
  expect(requestYoloChange(true)).toBe("confirm");
  expect(requestYoloChange(false)).toBe("save");
  const html = row({confirming: true});
  expect(html).toContain('role="alertdialog"');
  for (const text of [
    "Agent bude v priečinkoch klientov bez pýtania presúvať, premenúvať, upravovať a mazať súbory a spúšťať príkazy.",
    "Môže čítať a meniť aj súbory v priečinkoch iných klientov. Dôvernosť medzi klientmi sa v YOLO Mode nestráži.",
    "LAWOSS tieto zmeny nevie vrátiť. Majte zálohy.",
    "Zapnúť YOLO Mode", "Zrušiť",
  ]) expect(html).toContain(text);
  // The switch stays off until the confirmation is accepted.
  expect(html).toContain('aria-checked="false"');
  const source = readFileSync(join(import.meta.dir, "../src/lawoss/domains/yolo/yolo-mode.tsx"), "utf8");
  expect(source).not.toMatch(/\bconfirm\(/);
});

test("on and firm-locked states are visible; a firm lock disables the switch", () => {
  const enabled = row({mode: on});
  expect(enabled).toContain('data-lawoss-yolo="on"');
  expect(enabled).toContain('aria-checked="true"');
  expect(enabled).toContain("Pravidlá nižšie pre úpravy, príkazy a priečinky sa teraz neuplatňujú.");
  expect(enabled).toContain("Prejaví sa bez reštartu appky");
  const firm = row({mode: locked});
  expect(firm).toContain('data-lawoss-yolo="locked"');
  expect(firm).toContain('data-disabled=""');
  expect(firm).toContain('aria-checked="false"');
  expect(firm).toContain("Vaša organizácia spravuje povolenia nástrojov");
  expect(firm).not.toContain("Prejaví sa bez reštartu appky");
  const guest = row({canWrite: false});
  expect(guest).toContain('data-disabled=""');
});

test("the YOLO badge shows only while YOLO Mode is on", () => {
  expect(renderToStaticMarkup(<YoloBadgeView mode={null} />)).toBe("");
  expect(renderToStaticMarkup(<YoloBadgeView mode={off} />)).toBe("");
  expect(renderToStaticMarkup(<YoloBadgeView mode={locked} />)).toBe("");
  const badge = renderToStaticMarkup(<YoloBadgeView mode={on} />);
  expect(badge).toContain(">YOLO<");
  expect(badge).toContain('data-lawoss-yolo-badge=""');
  publishYoloMode(on);
  expect(renderToStaticMarkup(<YoloBadge />)).toContain(">YOLO<");
  publishYoloMode(off);
  expect(renderToStaticMarkup(<YoloBadge />)).toBe("");
});

test("the model is told about YOLO Mode in the turn context only while it is on", () => {
  publishYoloMode(on);
  expect(yoloTurnContext()).toContain("YOLO Mode is on");
  publishYoloMode(locked);
  expect(yoloTurnContext()).toBeNull();
  publishYoloMode(off);
  expect(yoloTurnContext()).toBeNull();
});

test("server responses are validated; anything else is not trusted", () => {
  expect(parseYoloMode(on)).toEqual(on);
  expect(parseYoloMode({enabled: "yes", locked: false, source: "user"})).toBeNull();
  expect(parseYoloMode(null)).toBeNull();
});

test("saving goes through the native host with both credentials", async () => {
  const received: Array<{method: string; path: string; hostToken: string | null; body: unknown}> = [];
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    received.push({method: request.method, path: new URL(request.url).pathname, hostToken: request.headers.get("x-legalwork-host-token"), body: await request.json()});
    return Response.json(on);
  }});
  try {
    const client = createLegalworkServerClient({baseUrl: server.url.origin, token: "client", hostToken: "native-host"});
    expect(await saveYoloMode(client, true)).toEqual(on);
    expect(received).toEqual([{method: "PUT", path: "/lawoss/yolo", hostToken: "native-host", body: {enabled: true}}]);
  } finally {server.stop(true);}
});

test("every locale names the switch YOLO Mode and explains the risk; German has no em dash", () => {
  const keys = ["lawoss.yolo.title", "lawoss.yolo.description", "lawoss.yolo.confirm_body", "lawoss.yolo.confirm_clients", "lawoss.yolo.confirm_undo", "lawoss.yolo.badge"] as const;
  for (const dictionary of [shellEn, shellCs, shellSk, shellDe]) {
    expect(dictionary["lawoss.yolo.title"]).toBe("YOLO Mode");
    expect(dictionary["lawoss.yolo.badge"]).toBe("YOLO");
    for (const key of keys) expect(dictionary[key].length).toBeGreaterThan(0);
  }
  expect(shellCs["lawoss.yolo.confirm_body"]).not.toBe(shellSk["lawoss.yolo.confirm_body"]);
  expect(shellDe["lawoss.yolo.confirm_body"]).not.toBe(shellEn["lawoss.yolo.confirm_body"]);
  for (const [key, value] of Object.entries(shellDe)) if (key.startsWith("lawoss.yolo.")) expect(value).not.toContain("—");
});

test("the native hooks stay wired: Safety settings, the composer badge and the turn context", () => {
  const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");
  expect(read("src/react-app/shell/settings-route.tsx")).toContain("<YoloModeRow");
  expect(read("src/react-app/domains/session/surface/composer/composer.tsx")).toContain("<YoloBadge />");
  expect(read("src/react-app/shell/session-route.tsx")).toContain("yoloTurnContext()");
});
