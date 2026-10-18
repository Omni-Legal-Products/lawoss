import { test } from "node:test";
import { strict as assert } from "node:assert";
import { emailComposeLink } from "../src/components/chat/email-draft-links";

const draft = { from: "from@example.com", replyTo: "reply@example.com", to: "Jane <jane+legal@example.com>, other@example.com", cc: "team@example.com", bcc: "archive@example.com", subject: "Settlement & review? Grüße", body: "Hello + world\nLine two & details", html: "<p>Hello</p>", attachments: [{ path: "contract.pdf", contentType: "application/pdf" }] };
for (const app of ["system", "gmail", "outlook"] satisfies Array<"system" | "gmail" | "outlook">) test(`${app} compose link keeps recipients and special characters without sending`, () => {
  const link = emailComposeLink(draft, app), url = new URL(link);
  assert.equal(url.searchParams.get("cc"), draft.cc); assert.equal(url.searchParams.get("bcc"), draft.bcc);
  assert.equal(url.searchParams.get("body"), app === "system" ? draft.body.replace(/\n/g, "\r\n") : draft.body);
  assert.equal(url.searchParams.get(app === "gmail" ? "su" : "subject"), draft.subject);
  assert.equal(app === "system" ? decodeURIComponent(url.pathname) : url.searchParams.get("to"), app === "system" ? "jane+legal@example.com,other@example.com" : draft.to);
  assert.equal(url.searchParams.has("attachments"), false); assert.equal(url.searchParams.has("from"), false);
  if (app === "system") { assert.equal(url.protocol, "mailto:"); assert.equal(url.search.includes("+"), false); }
  else assert.equal(url.host, app === "gmail" ? "mail.google.com" : "outlook.office.com");
});

test("mailto strips quoted display names without splitting commas inside names or addresses", () => {
  const url = new URL(emailComposeLink({ ...draft, to: '\"Müller, Anna\" <anna@example.com>, \"local,part\"@example.com', cc: '\"Doe, Jane\" <jane@example.com>', bcc: 'Archive <archive@example.com>' }, "system"));
  assert.equal(decodeURIComponent(url.pathname), 'anna@example.com,\"local,part\"@example.com');
  assert.equal(url.searchParams.get("cc"), "jane@example.com");
  assert.equal(url.searchParams.get("bcc"), "archive@example.com");
});
