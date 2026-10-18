import { emailAddressSpecs, type EmailDraftInput } from "@legalwork/types/email-draft";

export type EmailApp = "system" | "gmail" | "outlook";

/** Compose links need no mail account connection and never send a message. */
export function emailComposeLink(draft: EmailDraftInput, app: EmailApp): string {
  const query = new URLSearchParams();
  if (app === "gmail") { query.set("view", "cm"); query.set("fs", "1"); }
  if (draft.to && app !== "system") query.set("to", draft.to);
  if (draft.cc) query.set("cc", app === "system" ? emailAddressSpecs(draft.cc).join(",") : draft.cc);
  if (draft.bcc) query.set("bcc", app === "system" ? emailAddressSpecs(draft.bcc).join(",") : draft.bcc);
  query.set(app === "gmail" ? "su" : "subject", draft.subject);
  query.set("body", app === "system" ? draft.body.replace(/\r?\n/g, "\r\n") : draft.body);
  if (app === "system") {
    // RFC 6068 needs percent-encoded spaces, not form encoding's literal '+'.
    return `mailto:${emailAddressSpecs(draft.to).map(address => encodeURIComponent(address)).join(",")}?${query.toString().replace(/\+/g, "%20")}`;
  }
  return `${app === "gmail" ? "https://mail.google.com/mail/u/0/" : "https://outlook.office.com/mail/deeplink/compose"}?${query}`;
}
