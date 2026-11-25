import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { refreshChevron7Files } from "../src/lawoss/domains/integrations/chevron7-file-action";
import { renderToStaticMarkup } from "react-dom/server";
import { setLocale, t } from "../src/i18n";
import { PdfSignatureDetails } from "../src/lawoss/pdf/signature-badge";
import type { PdfSignatureReport } from "../src/lawoss/pdf/signature-report";

const render = (report: PdfSignatureReport | null) => renderToStaticMarkup(<PdfSignatureDetails report={report} />);
const empty: PdfSignatureReport = { status: "inspected", emptyFields: 0, signatures: [] };

describe("embedded PDF signature disclosure", () => {
  it("shows metadata as escaped text, distinguishes a timestamp, and discloses trust in all four locales", () => {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      setLocale(locale);
      const html = render({ ...empty, signatures: [
        { kind: "signature", subFilter: "ETSI.CAdES.detached", fieldName: "Pilot", signer: "<Synthetic>", issuer: "Test Authority", signedAt: "2035-05-14T10:30:00+01:00" },
        { kind: "timestamp", subFilter: "ETSI.RFC3161", signedAt: "2035-05-14T11:30:00" },
      ] });
      for (const key of ["unverified", "trust_note", "no_timezone", "issuer"]) {
        const value = t("lawoss.pdf_signatures." + key, locale);
        expect(value).not.toContain("lawoss.");
        expect(html).toContain(value);
      }
      expect(html).toContain("<summary");
      expect(html).toContain("CAdES</dd>");
      expect(html).toContain("RFC 3161</dd>");
      expect(html).toContain("Test Authority");
      expect(html).toContain("&lt;Synthetic&gt;");
      expect(html).toContain("lucide-clock");
    }
  });

  it("counts empty fields separately and never reports an inconclusive inspection as unsigned", () => {
    setLocale("sk");
    expect(render(null)).toContain("Načítavajú sa podpisy PDF");
    expect(render(empty)).toContain("V PDF sa nenašiel elektronický podpis");
    expect(render({ ...empty, emptyFields: 2 })).toContain("Prázdne podpisové polia (2)");
    for (const status of ["partial", "unavailable"] as const) {
      const html = render({ ...empty, status, issue: "encrypted" });
      expect(html).not.toContain("V PDF sa nenašiel elektronický podpis");
      expect(html).toContain("Podpisy sa nepodarilo skontrolovať");
      expect(html).toContain("PDF je zašifrované.");
    }
  });

  it("never counts a document timestamp as an electronic signature and flags incomplete counts", () => {
    setLocale("en");
    const html = render({ ...empty, status: "partial", issue: "limit", signatures: [{kind: "timestamp"}] });
    expect(html).toContain("Document timestamps (1)");
    expect(html).not.toContain("Electronic signatures (1)");
    expect(html).toContain("Some signatures could not be inspected");
    expect(html).not.toContain("Declared time");
  });
});

it("refreshes the selected source and its file listing after the native action, including project tabs", async () => {
  const cache = new QueryClient();
  const selection = { workspaceId: "workspace", relativePath: "folder/test.pdf", serverUrl: "http://localhost:1111" };
  const keys = [
    ["artifact-panel", "workspace", "project-file-1", selection.serverUrl],
    ["artifact-panel", "workspace", "other-file", selection.serverUrl],
    ["artifact-panel", "workspace", "same-path-other-server", "http://localhost:2222"],
    ["workspace-files", "workspace", selection.serverUrl, "folder"],
  ];
  for (const [index, queryKey] of keys.entries()) {
    await cache.fetchQuery({ queryKey, queryFn: () => index, meta: { pdfPath: index === 1 ? "other.pdf" : selection.relativePath } });
  }
  refreshChevron7Files(cache, selection);
  expect(keys.map(key => cache.getQueryState(key)?.isInvalidated)).toEqual([true, false, false, true]);
  cache.clear();
});
