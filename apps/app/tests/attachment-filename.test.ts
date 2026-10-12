import { expect, test } from "bun:test";
import { attachmentFilename } from "../src/app/lib/attachment-filename";
import { classifyOpenTarget } from "../src/react-app/domains/session/artifacts/open-target";

test("legacy attachment names retain their document format without rewriting ordinary names", () => {
  for (const [extension, preview] of [["docx", "word"], ["xlsx", "sheet"], ["pptx", "slides"], ["pdf", "pdf"], ["md", "markdown"]]) {
    const path = `.legalwork/attachments/id/Input.${extension}___Project_Name`;
    expect(attachmentFilename(path)).toBe(`Input.${extension}`);
    expect(classifyOpenTarget(path, "file")).toBe(preview);
    expect(attachmentFilename(`files/Input.${extension}___Project_Name`)).toBe(`Input.${extension}___Project_Name`);
  }
  expect(attachmentFilename("folder/a.docx.zip")).toBe("a.docx.zip");
  expect(attachmentFilename(".legalwork/attachments/id/Contract.docx")).toBe("Contract.docx");
  expect(classifyOpenTarget("https://example.com/file.docx", "url")).toBe("browser");
});
