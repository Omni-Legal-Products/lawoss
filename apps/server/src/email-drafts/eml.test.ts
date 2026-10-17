import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderEml } from "./eml.js";
import type { EmailDraftInput } from "@legalwork/types/email-draft";

const input: EmailDraftInput = { from: "Counsel <counsel@example.com>", replyTo: "reply@example.com", to: "client@example.com", cc: "team@example.com", bcc: "archive@example.com", subject: "Review : überfällig", body: "Hello\nGrüße 👋", html: "", attachments: [] };
test("exports normal draft headers and encoded Unicode with CRLF", () => {
  const eml = renderEml(input, [], new Date("2026-01-01T00:00:00Z"));
  for (const header of ["X-Unsent: 1", "From: Counsel <counsel@example.com>", "Reply-To: reply@example.com", "To: client@example.com", "Cc: team@example.com", "Bcc: archive@example.com", "MIME-Version: 1.0"]) assert.ok(eml.includes(header));
  assert.equal(eml.includes("\n") && !/(^|[^\r])\n/.test(eml), true);
  assert.ok(eml.includes(Buffer.from(input.subject).toString("base64")));
  assert.ok(eml.includes(Buffer.from("Hello\r\nGrüße 👋").toString("base64")));
});
test("includes HTML alternative inside mixed MIME with binary attachments", () => {
  const data = Buffer.from([0, 255, 128, 10, 13]);
  const eml = renderEml({ ...input, html: "<p>Hello</p>" }, [{ name: "Résumé.pdf", contentType: "application/pdf", data }]);
  assert.ok(eml.includes("multipart/mixed")); assert.ok(eml.includes("multipart/alternative"));
  assert.ok(eml.includes("text/plain")); assert.ok(eml.includes("text/html"));
  assert.ok(eml.includes("filename*=UTF-8''R%C3%A9sum%C3%A9.pdf"));
  assert.ok(eml.includes(data.toString("base64")));
});
test("folds long Unicode subjects and encodes international display names", () => {
  const eml = renderEml({ ...input, subject: "⚖️".repeat(80), to: '"Müller" <client@example.com>' }, []);
  const words = eml.match(/=\?UTF-8\?B\?[^?]+\?=/g) ?? [];
  assert.ok(words.length > 5); assert.ok(words.every(word => word.length <= 75));
  assert.ok(eml.includes(" <client@example.com>"));
});
test("rejects header and MIME injection", () => {
  assert.throws(() => renderEml({ ...input, subject: "Hello\r\nBcc: evil@example.com" }, []));
  assert.throws(() => renderEml(input, [{ name: "x\r\nmalicious", contentType: "application/pdf", data: Buffer.alloc(0) }]));
  assert.throws(() => renderEml(input, [{ name: "x", contentType: "text/plain\r\nBad: 1", data: Buffer.alloc(0) }]));
});

test("preserves quoted commas and encodes the complete international display name", () => {
  const eml = renderEml({ ...input, to: '\"Müller, Anna\" <anna@example.com>, \"Doe, Jane\" <jane@example.com>, \"local,part\"@example.com' }, []);
  assert.ok(eml.includes(`To: =?UTF-8?B?${Buffer.from("Müller, Anna").toString("base64")}?= <anna@example.com>,\r\n \"Doe, Jane\" <jane@example.com>,\r\n \"local,part\"@example.com`));
});
