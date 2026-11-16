import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { EngineProjectRecoveryNotice } from "../src/react-app/domains/workspace/engine-project-approval";
import { ENGINE_PROJECT_DIAGNOSTIC_KEYS, engineProjectDiagnosticText } from "../src/lawoss/i18n/engine-project-diagnostic";
import { diagnosticsEn } from "../src/lawoss/i18n/diagnostics";

// LAWOSS #509: the server's fixed sentences about a client's generated OpenCode settings are shown localized.
const server = readFileSync(join(import.meta.dir, "../../server/src/engine-project.ts"), "utf8");

test("#509: every mapped sentence is the server's exact text and has a translation key", () => {
  for (const [sentence, key] of Object.entries(ENGINE_PROJECT_DIAGNOSTIC_KEYS)) {
    expect(server).toContain(JSON.stringify(sentence).slice(1, -1));
    expect(Object.hasOwn(diagnosticsEn, key)).toBe(true);
  }
});

test("#509: the conflict banner is Slovak, keeps the original as technical detail, and unknown text stays literal", () => {
  const edited = "The LegalWork-generated OpenCode file was changed outside LegalWork. Preserve your edits by moving them into another native OpenCode config file, then remove this generated file and retry.";
  expect(engineProjectDiagnosticText(edited, "sk")).toContain("bol zmenený mimo LAWOSS");
  expect(engineProjectDiagnosticText(edited, "cs")).toContain("byl změněn mimo LAWOSS");
  expect(engineProjectDiagnosticText(edited, "de")).toContain("außerhalb von LAWOSS geändert");
  expect(engineProjectDiagnosticText("Something new from the server.", "sk")).toBe("Something new from the server.");
  const html = renderToStaticMarkup(<EngineProjectRecoveryNotice onRetry={() => undefined}
    status={{ state: "configuration_conflict", required: false, directory: "/synthetic", approvalScope: [], plugins: [], projection: { path: "/synthetic/.opencode/opencode.json", diagnostic: edited } }} />);
  expect(html).toContain("The settings file that LAWOSS generates");
  expect(html).toContain("<details");
  expect(html).toContain(edited.slice(0, 40));
});
