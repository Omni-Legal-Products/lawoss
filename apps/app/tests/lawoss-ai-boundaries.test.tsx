import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LegalworkServerError } from "../src/app/lib/legalwork-server";
import { AiBoundariesRowView, saveAiBoundaries } from "../src/lawoss/domains/ai/boundaries";
import { aiBoundariesRefusal } from "../src/lawoss/domains/ai/boundaries-refusal";

const noop = () => {};

test("the AI boundaries row shows the alpha default off with a plain explanation and an enabled switch", () => {
  const html = renderToStaticMarkup(<AiBoundariesRowView locale="sk" boundaries={{enforced: false, locked: false, source: "default"}} canWrite busy={false} failed={false} onChange={noop} />);
  expect(html).toContain("AI hranice");
  expect(html).toContain("appka neposiela obsah spisov žiadnemu modelu okrem chráneného generovania dokumentov");
  expect(html).toContain('data-lawoss-ai-boundaries="off"');
  expect(html).toContain('aria-checked="false"');
  expect(html).not.toContain('data-disabled=""');
});

test("on and firm-locked states are visible; a firm lock disables the switch", () => {
  const on = renderToStaticMarkup(<AiBoundariesRowView locale="sk" boundaries={{enforced: true, locked: false, source: "user"}} canWrite busy={false} failed={false} onChange={noop} />);
  expect(on).toContain('data-lawoss-ai-boundaries="on"');
  expect(on).toContain('aria-checked="true"');
  expect(on).toContain("Bežný chat je vypnutý");
  const locked = renderToStaticMarkup(<AiBoundariesRowView locale="sk" boundaries={{enforced: true, locked: true, source: "firm"}} canWrite busy={false} failed={false} onChange={noop} />);
  expect(locked).toContain('data-lawoss-ai-boundaries="locked"');
  expect(locked).toContain('data-disabled=""');
  expect(locked).toContain("kancelária");
});

test("every locale renders the row; without the native host the switch is disabled", () => {
  for (const locale of ["cs", "sk", "en", "de"] as const) {
    const html = renderToStaticMarkup(<AiBoundariesRowView locale={locale} boundaries={null} canWrite={false} busy={false} failed={false} onChange={noop} />);
    expect(html).toContain('data-disabled=""');
    expect(html).toContain('role="switch"');
  }
});

test("toggling saves the switch through the native host with both current credentials", async () => {
  const received: Array<{method: string; path: string; token: string | null; hostToken: string | null; body: unknown}> = [];
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    received.push({method: request.method, path: new URL(request.url).pathname, token: request.headers.get("authorization"), hostToken: request.headers.get("x-legalwork-host-token"), body: await request.json()});
    return Response.json({guidanceVersion: "fixture", guidanceAck: null, protectedProcessing: "unsupported", blockers: [], capabilities: [], boundaries: {enforced: true, locked: false, source: "user"}});
  }});
  try {
    const connection = {normalizedBaseUrl: server.url.origin, resolvedToken: "current-client", resolvedHostToken: "current-native-host", source: "desktop-runtime" as const, hostInfo: null};
    expect(await saveAiBoundaries(connection, true)).toEqual({enforced: true, locked: false, source: "user"});
    expect(received).toEqual([{method: "PUT", path: "/lawoss/ai-governance/boundaries", token: "Bearer current-client", hostToken: "current-native-host", body: {enforced: true}}]);
  } finally {server.stop(true);}
});

test("a refused chat send becomes a localized sentence pointing to the setting, never the raw English text", () => {
  const typed = new LegalworkServerError(403, "ai_transfer_denied", "Protected AI processing is unavailable. Continue manually without a model.");
  const sk = aiBoundariesRefusal(typed, "sk");
  expect(sk).toContain("AI hranice");
  expect(sk).toContain("Nastaveniach → Poskytovatelia AI");
  expect(sk).not.toContain("Protected AI processing");
  const cs = aiBoundariesRefusal(new Error(JSON.stringify({code: "ai_transfer_denied", message: "Protected AI processing is unavailable."})), "cs");
  expect(cs).toContain("Nastavení → Poskytovatelé AI");
  expect(cs).not.toBe(sk);
  expect(aiBoundariesRefusal(new Error("Protected AI processing is unavailable. Continue manually without a model."), "sk")).toBe(sk);
  expect(aiBoundariesRefusal(new LegalworkServerError(409, "recovery_changed", "Other"), "sk")).toBeNull();
  // Protected document generation uses the same code for its own refusals; AI hranice are not the cause there.
  expect(aiBoundariesRefusal(new LegalworkServerError(403, "ai_transfer_denied", "The current legal profile does not admit this protected transmission.", {reason: "profile-missing"}), "sk")).toBeNull();
  expect(aiBoundariesRefusal(new LegalworkServerError(403, "ai_transfer_denied", "A current matter and explicit CZ/SK jurisdiction are required.", {reason: "unknown-context"}), "sk")).toBeNull();
  expect(aiBoundariesRefusal({code: "ai_transfer_denied", message: "The legal profile does not admit this protected transmission."}, "sk")).toBeNull();
  expect(aiBoundariesRefusal(new Error("network down"), "sk")).toBeNull();
});
