import {expect, test} from "bun:test";
import {fileURLToPath} from "node:url";
import * as composer from "../src/react-app/domains/session/surface/composer/composer-draft";
import {createWorkspaceAttachmentMention, uploadWorkspaceAttachment, workspaceAttachmentDisplayText} from "../src/react-app/domains/session/surface/composer/workspace-attachment";
import {encodeComposerMentionValue} from "../src/react-app/domains/session/surface/composer/mention-encoding";

const path = ".legalwork/attachments/00000000-0000-4000-8000-000000000001/source.pdf";
const make = (reference: string) => composer.buildComposerDraft(`@${encodeComposerMentionValue(reference)} follow-up`, [], {[reference]: "upload"}, []);

test("the actual upload draft keeps ordinary JSON unchanged while protected sending carries a typed copy under the registered workspace root", async () => {
  let uploaded = "";
  const reference = await uploadWorkspaceAttachment({writeWorkspaceBinaryFile: async (workspaceId, input) => {
    expect(workspaceId).toBe("owner"); expect(new TextDecoder().decode(input.data)).toBe("SYNTHETIC selected original");
    uploaded = input.path; return {ok: true, path: input.path, bytes: input.data.byteLength, updatedAt: 1};
  }}, "owner", new File(["SYNTHETIC selected original"], "Příloha #1.pdf"));
  const draft = make(reference), before = JSON.stringify(draft);
  expect(draft.parts[0]).toEqual({type: "text", text: workspaceAttachmentDisplayText(reference)});
  const converted = composer.protectedWorkspaceUploadParts(draft, "/physical workspace/%literal#root");
  expect(converted.size).toBe(1);
  const file = converted.get(draft.parts[0])!;
  expect(file.type).toBe("file"); expect(file.filename).toBe("Příloha #1.pdf");
  expect(fileURLToPath(file.url)).toBe(`/physical workspace/%literal#root/${uploaded}`);
  expect(file.url).not.toContain("selected-subcase");
  expect(JSON.stringify(draft)).toBe(before);
  expect(Object.keys(draft)).not.toContain("workspaceUploads");
  // The real onSendDraft receives the prepared draft; shallow queue wrappers
  // retain parts, while an edit rebuilds from persisted editor mention data.
  expect(composer.protectedWorkspaceUploadParts({...draft, parts: [...draft.parts]}, "/physical workspace").size).toBe(1);
  expect(composer.protectedWorkspaceUploadParts(make(reference), "/physical workspace").size).toBe(1);
});

test("Markdown lookalikes and unregistered mentions never become file capabilities", () => {
  const reference = createWorkspaceAttachmentMention("source.pdf", path);
  for (const text of [workspaceAttachmentDisplayText(reference), `@${encodeComposerMentionValue(reference)}`]) {
    const draft = composer.buildComposerDraft(text, [], {}, []);
    expect(composer.protectedWorkspaceUploadParts(draft, "/physical").size).toBe(0);
    expect(draft.parts.every(part => part.type === "text")).toBe(true);
  }
});

test("altered registered text, pending project references and unsafe upload locations refuse protected conversion", () => {
  const draft = make(createWorkspaceAttachmentMention("source.pdf", path));
  (draft.parts[0] as {type: "text"; text: string}).text = "changed after attachment selection";
  expect(() => composer.protectedWorkspaceUploadParts(draft, "/physical")).toThrow();
  for (const reference of [
    "attachment://workspace?name=missing-path",
    createWorkspaceAttachmentMention("source.pdf", "../foreign/source.pdf"),
    createWorkspaceAttachmentMention("source.pdf", "case/original.pdf"),
    createWorkspaceAttachmentMention("source.pdf", ".legalwork/attachments/not-a-uuid/source.pdf"),
    createWorkspaceAttachmentMention("source.pdf", path)+"&source="+encodeURIComponent(JSON.stringify({projectId: "foreign"})),
  ]) expect(() => composer.protectedWorkspaceUploadParts(make(reference), "/physical")).toThrow();
  expect(() => composer.protectedWorkspaceUploadParts(make(createWorkspaceAttachmentMention("source.pdf", path)), "relative/subcase")).toThrow();
});

test("protected upload URLs preserve the registered Windows drive and escaped path without selecting a subcase root", () => {
  const draft = make(createWorkspaceAttachmentMention("source.pdf", path));
  const file = composer.protectedWorkspaceUploadParts(draft, "C:\\Physical workspace\\Český spis").get(draft.parts[0])!;
  expect(file.url).toBe("file:///C:/Physical%20workspace/%C4%8Cesk%C3%BD%20spis/"+path);
});
