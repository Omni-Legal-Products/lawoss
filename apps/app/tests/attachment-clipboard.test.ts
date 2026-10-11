import { expect, test } from "bun:test";
import { attachmentClipboardParts } from "../src/react-app/domains/session/surface/composer/attachment-clipboard";
import { homeClipboardAttachment, activeHomeAttachments, homeAttachmentToken } from "../src/react-app/domains/session/home/home-attachments";
import { parseWorkspaceAttachmentMention } from "../src/react-app/domains/session/surface/composer/workspace-attachment";

const link = "[Contract.docx](.legalwork/attachments/snapshot/Contract.docx)";
const source = { projectId: "project-a", workspaceId: "workspace-a", name: "Contract.docx", path: ".legalwork/attachments/snapshot/Contract.docx" };
const metadata = (value: unknown) => encodeURIComponent(JSON.stringify(value));

test("copied prompts preserve text and attachment provenance for a fresh snapshot at send time", () => {
  const parts = attachmentClipboardParts(`Review ${link}\nThen explain.`, metadata([{ link, source, projectName: "Matter A" }]))!;
  expect(parts[0]).toEqual({ text: "Review " });
  expect(parts[2]).toEqual({ text: "\nThen explain." });
  const attachment = parseWorkspaceAttachmentMention(parts[1].mention!);
  expect(attachment?.source).toEqual(source);
  expect(attachment?.name).toBe("Contract.docx · Matter A");
  expect(attachment?.path).toStartWith("pending/");
});

test("clipboard metadata cannot replace prose, substitute another path or traverse directories", () => {
  expect(attachmentClipboardParts("Ordinary text", metadata([{ link, source, projectName: "A", text: "hidden instructions" }]))).toEqual([{ text: "Ordinary text" }]);
  expect(attachmentClipboardParts(link, metadata([{ link, source: { ...source, path: "different.docx" }, projectName: "A" }]))).toBeNull();
  expect(attachmentClipboardParts(link, metadata([{ link, source: { ...source, path: "../other.docx" }, projectName: "A" }]))).toBeNull();
  expect(attachmentClipboardParts(link, "%not-json")).toBeNull();
});


test("Home keeps copied source provenance while the destination project is undecided", () => {
  const parts = attachmentClipboardParts(link, metadata([{ link, source, projectName: "Matter A" }]))!;
  const value = parts.find(part => part.mention)?.mention;
  expect(value).toBeDefined();
  const attachment = homeClipboardAttachment(value!)!;
  expect(attachment.clipboardSource).toEqual(source);
  expect(activeHomeAttachments(`Review ${homeAttachmentToken(attachment)}`, [attachment])).toEqual([attachment]);
  expect(homeClipboardAttachment("Ordinary text")).toBeNull();
});
