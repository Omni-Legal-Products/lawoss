import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PdfPreview } from "../src/react-app/domains/session/artifacts/preview";
import { pdfPreviewUrl } from "../src/react-app/domains/session/artifacts/pdf-preview-url";

describe("PDF preview opening", () => {
  it("starts with the sidebar closed while keeping the viewer toolbar available", () => {
    const html = renderToStaticMarkup(<PdfPreview url="blob:http://localhost/document" title="Contract.pdf" />);
    expect(html).toContain('src="blob:http://localhost/document#navpanes=0"');
    expect(html).not.toContain("toolbar=0");
  });

  it("overrides incoming sidebar requests without losing citation pages or zoom", () => {
    const url = new URL(pdfPreviewUrl("blob:http://localhost/document#page=3&navpanes=1&zoom=150&navpanes=1"));
    const params = new URLSearchParams(url.hash.slice(1));
    expect(params.getAll("navpanes")).toEqual(["0"]);
    expect(params.get("page")).toBe("3");
    expect(params.get("zoom")).toBe("150");
  });

  it("keeps the sidebar closed on programmatic page navigation", () => {
    const url = new URL(pdfPreviewUrl("blob:http://localhost/document#page=3&navpanes=1", 7));
    const params = new URLSearchParams(url.hash.slice(1));
    expect(params.get("page")).toBe("7");
    expect(params.get("navpanes")).toBe("0");
  });
});
