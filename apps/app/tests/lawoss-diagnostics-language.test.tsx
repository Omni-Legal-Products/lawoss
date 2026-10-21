import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { parseWorkingProfile } from "../../../lawoss/okf/src/profile";
import { readWorkspaceMemory, type OkfReadClient } from "../src/lawoss/okf/read-model";
import { OkfPageState } from "../src/lawoss/domains/okf-page";
import { saveDocumentsToMatter } from "../src/lawoss/lite/matter-intake";
import { diagnosticText } from "../src/lawoss/i18n/diagnostic-message";

test("presentation follows its supplied current language while source data and interpolation stay literal", () => {
  const diagnostic = { code: "okf.intake_unregistered", params: { path: "pôvodný-$&-{path}.pdf" }, message: "pôvodná chyba" };
  for (const [locale, expected] of [["cs", "Originál byl uložen"], ["sk", "Originál bol uložený"], ["en", "The original was saved"], ["de", "Das Original wurde"]] as const) {
    expect(diagnosticText(diagnostic, locale)).toContain(expected);
    expect(diagnosticText(diagnostic, locale)).toContain(diagnostic.params.path);
  }
  expect(diagnostic.message).toBe("pôvodná chyba");
  expect(diagnosticText(new Error("žiadne oprávnenie"), "cs")).toContain("Operaci se nepodařilo dokončit.");
});

test("real truncated reads carry a stable diagnostic and render localized copy with original details separately", async () => {
  const client: OkfReadClient = {
    listWorkspaceDirectory: async () => ({ path: "", entries: [], truncated: true }),
    readWorkspaceFile: async () => { throw new Error("404 not found"); },
  };
  const data = await readWorkspaceMemory(client, "synthetic", "2026-10-20");
  expect(data.problems[0]).toMatchObject({ code: "okf.listing_incomplete" });
  const before = JSON.stringify(data);
  const html = renderToStaticMarkup(<MemoryRouter><OkfPageState connection="ready" workspace="pôvodný názov" data={data} loading={false} error={null}>{() => "empty"}</OkfPageState></MemoryRouter>);
  expect(html).toContain("The directory listing is incomplete.");
  expect(html).toContain("Technical details");
  expect(html).toContain("Neúplný výpis priečinka zo servera.");
  expect(html).toContain("<details");
  expect(JSON.stringify(data)).toBe(before);
});

test("invalid working profiles retain their old diagnostic and gain a stable presentation code", () => {
  let failure: unknown;
  try { parseWorkingProfile("---\ntype: invalid\n---\n"); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: "okf.profile_invalid", params: { path: "PRACOVNY-PROFIL.md" }, message: "Neplatný PRACOVNY-PROFIL.md" });
});

test("a failed intake registration identifies the already-saved original without translating the filename", async () => {
  const originals: string[] = [];
  const client = {
    readWorkspaceFile: async () => { throw new Error("404 not found"); },
    writeWorkspaceBinaryFile: async (_id: string, input: { path: string }) => { originals.push(input.path); return { ok: true as const, path: input.path, bytes: 1, updatedAt: 1 }; },
    writeWorkspaceFile: async () => { throw new Error("EACCES pôvodná chyba"); },
  };
  await expect(saveDocumentsToMatter(client, "synthetic", { path: "case", title: "pôvodný názov" }, [new File(["test"], "pôvodný-$&.pdf")]))
    .rejects.toMatchObject({ code: "okf.intake_unregistered", params: { path: "case/00_K_zarazeni/IN-001/pôvodný-$&.pdf" } });
  expect(originals).toEqual(["case/00_K_zarazeni/IN-001/pôvodný-$&.pdf"]);
});
