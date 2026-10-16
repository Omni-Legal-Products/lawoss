import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILT_IN_LEGALWORK_EXTENSION_MANIFESTS } from "../src/app/extensions";
import { ActaportConfig, ActaportToolsets } from "../src/react-app/domains/settings/actaport-config";
import type { ActaportConnectionStatus } from "@legalwork/types/desktop-ipc";

test("Actaport is a bundled MCP extension with a dedicated setup form", () => {
  const entry = BUILT_IN_LEGALWORK_EXTENSION_MANIFESTS.find((item) => item.id === "actaport");
  expect(entry?.resources[0].localCommandRef).toBe("legalwork.actaportMcp");
  expect(entry?.resources[0].command?.join(" ")).not.toContain("npx");
  const html = renderToStaticMarkup(React.createElement(ActaportConfig));
  expect((html.match(/<input/g) ?? []).length).toBe(5);
  expect((html.match(/type="password"/g) ?? []).length).toBe(2);
  expect(html).toContain("Kanzlei-Alias");
  expect(html).toContain("API username");
  expect(html).toContain("API password");
  expect(html).toContain("API add-on");
  expect(html).not.toContain("ACTAPORT_CLIENT_SECRET");
});

test("tool group settings show the minimal count and count only selected, permitted operations", () => {
  const status: ActaportConnectionStatus = { configured: true, secureStorage: true, allowWrites: false,
    coreToolCount: 15, enabledToolsets: [], toolsets: [
      { id: "records", readTools: 8, writeTools: 19 }, { id: "finance", readTools: 14, writeTools: 15 },
      { id: "administration", readTools: 13, writeTools: 0 }, { id: "uploads", readTools: 4, writeTools: 4 },
    ] };
  const render = (value: ActaportConnectionStatus) => renderToStaticMarkup(React.createElement(ActaportToolsets, { status: value, busy: false, onChange: () => {} }));
  const minimal = render(status);
  expect(minimal).toContain("15 tools selected");
  expect(minimal).toContain("Large-file uploads");
  expect((minimal.match(/aria-checked="true"/g) ?? []).length).toBe(0);
  const finance = render({ ...status, enabledToolsets: ["finance"] });
  expect(finance).toContain("29 tools selected");
  expect((finance.match(/aria-checked="true"/g) ?? []).length).toBe(1);
  expect(render({ ...status, allowWrites: true, enabledToolsets: ["finance"] })).toContain("44 tools selected");
  expect(render({ ...status, allowWrites: true, enabledToolsets: status.toolsets.map(({ id }) => id) })).toContain("92 tools selected");
});
