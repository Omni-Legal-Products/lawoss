import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmailDraftInput } from "@legalwork/types/email-draft";
import { draftPaths, readDraft, saveEmailDraft } from "./store.js";

const input: EmailDraftInput = { from: "", replyTo: "", to: "client@example.com", cc: "", bcc: "", subject: "Draft", body: "Original", html: "", attachments: [] };
test("persists editable metadata and an EML with an attachment snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "legalwork-email-"));
  try {
    await writeFile(join(root, "document.pdf"), Buffer.from([0, 1, 255]));
    const draft = await saveEmailDraft(root, "ws_test", { ...input, attachments: [{ path: "document.pdf", contentType: "application/pdf" }] });
    assert.match(draft.path, /^\.legalwork\/email-drafts\/[a-f0-9-]+\.eml$/);
    assert.deepEqual(await readDraft(root, draft.id), draft);
    const eml = await readFile(join(root, draft.path), "utf8");
    assert.ok(eml.includes("AAH/"));
    await writeFile(join(root, "document.pdf"), "later");
    assert.equal(await readFile(join(root, draft.path), "utf8"), eml);
    const saved = await saveEmailDraft(root, "ws_test", { ...draft, cc: "colleague@example.com", body: "Human edit" }, draft);
    assert.notEqual(saved.revision, draft.revision); assert.equal(saved.id, draft.id);
    assert.ok((await readFile(join(root, saved.path), "utf8")).includes("Cc: colleague@example.com"));
    await assert.rejects(saveEmailDraft(root, "ws_test", input, draft), /changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("two simultaneous updates cannot overwrite one another", async () => {
  const root = await mkdtemp(join(tmpdir(), "legalwork-email-"));
  try {
    const draft = await saveEmailDraft(root, "ws_test", input);
    const results = await Promise.allSettled([saveEmailDraft(root, "ws_test", { ...input, body: "first" }, draft), saveEmailDraft(root, "ws_test", { ...input, body: "second" }, draft)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("rejects attachment traversal, symlink escapes and draft-directory escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "legalwork-email-")), outside = await mkdtemp(join(tmpdir(), "outside-email-"));
  try {
    await writeFile(join(outside, "secret"), "secret"); await symlink(join(outside, "secret"), join(root, "link"));
    for (const path of ["../secret", "/etc/passwd", "link", "..\\secret"]) await assert.rejects(saveEmailDraft(root, "ws_test", { ...input, attachments: [{ path, contentType: "application/octet-stream" }] }));
    await symlink(outside, join(root, ".legalwork"));
    await assert.rejects(saveEmailDraft(root, "ws_test", input), /inside this project/);
    await assert.rejects(draftPaths(root, "../../outside"));
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
test("missing or oversized attachments leave the previous draft intact", async () => {
  const root = await mkdtemp(join(tmpdir(), "legalwork-email-"));
  try {
    const draft = await saveEmailDraft(root, "ws_test", input);
    const eml = await readFile(join(root, draft.path), "utf8");
    await writeFile(join(root, "huge"), ""); await truncate(join(root, "huge"), 21 * 1024 * 1024);
    for (const path of ["missing", "huge"]) await assert.rejects(saveEmailDraft(root, "ws_test", { ...input, attachments: [{ path, contentType: "application/octet-stream" }] }, draft));
    assert.deepEqual(await readDraft(root, draft.id), draft); assert.equal(await readFile(join(root, draft.path), "utf8"), eml);
    await assert.rejects(readDraft(root, "00000000-0000-0000-0000-000000000000"), /not found/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
