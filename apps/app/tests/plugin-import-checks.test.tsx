import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PluginImportPreview } from "@legalwork/types/plugin-import";
import { PluginImportChecks } from "../src/react-app/domains/settings/pages/plugin-import-dialog";

const preview: PluginImportPreview = {
  id: "discord", name: "discord", digest: "reviewed", version: "0.0.4", description: null,
  format: "connectors", root: "", fileCount: 2, bytes: 300, readiness: "setup", validationId: "checked",
  components: [{ type: "mcp", name: "discord", installedName: "discord-installed" }], warnings: [],
  connectors: [{ name: "discord", installedName: "discord-installed", status: "setup", code: "local_program", message: "The program is available. Configure it after importing.", inputs: ["DISCORD_TOKEN"] }],
};
const noop = () => {};
function render(value = preview, technical = false, needsCheck = false, importable = true) {
  return renderToStaticMarkup(<PluginImportChecks preview={value} name="Discord" technical={technical} needsCheck={needsCheck} importable={importable} onCheck={noop} />);
}

test("a reviewed connector adds no routine setup panel to the main review", () => {
  expect(render()).toBe("");
  const technical = render(preview, true);
  expect(technical).toContain("The program is available.");
  expect(technical).toContain("DISCORD_TOKEN");
  expect(technical).toContain("Check again");
});

test("blocking reasons and recovery stay visible without repeating the connector name or status", () => {
  const blocked: PluginImportPreview = { ...preview, readiness: "unsupported", components: [], connectors: [{ ...preview.connectors![0]!, status: "blocked", code: "unreachable", message: "The provider refused the connection. Check network access.", retryable: true }] };
  const html = render(blocked, false, false, false);
  expect(html.match(/Cannot import/g)).toHaveLength(1);
  expect(html).toContain("The provider refused the connection.");
  expect(html).toContain("Check again");
  expect(html).not.toContain("Discord");
  expect(render(blocked, true)).not.toContain("The provider refused");
});

test("partial packages disclose omitted behavior while successful checks and dependency setup stay in details", () => {
  const partial: PluginImportPreview = { ...preview, readiness: "partial", requirements: [
    { kind: "dependency", name: "installed-helper", code: "dependency", required: true, status: "satisfied", message: "The helper is already installed." },
    { kind: "dependency", name: "account-helper", code: "dependency", required: true, status: "setup", message: "Finish the helper's sign-in after importing." },
    { kind: "runtime", name: "Automatic hooks", code: "hooks", required: false, status: "changed", message: "Automatic hooks will not run." },
  ] };
  const html = render(partial);
  expect(html).toContain("Not included");
  expect(html).toContain("Automatic hooks will not run.");
  expect(html).not.toContain("The program is available.");
  expect(html).not.toContain("already installed");
  expect(html).not.toContain("sign-in after importing");
  const technical = render(partial, true);
  expect(technical).toContain("already installed");
  expect(technical).toContain("sign-in after importing");
});

test("an unreviewed source still exposes the required check action", () => {
  expect(render({ ...preview, validationId: undefined }, false, true, false)).toContain("Check before importing");
});
